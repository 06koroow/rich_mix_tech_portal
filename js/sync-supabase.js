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
  if (unsupportedCols.procedures) {
    delete unsupportedCols.procedures;
    try { localStorage.setItem('rmtp_unsupported_cols', JSON.stringify(unsupportedCols)); } catch (e) {}
  }

  // Track recent local upserts (per collection+id) for 15s so an overlapping pull
  // never prematurely prunes a brand-new optimistic local record before its write completes.
  const recentLocalUpserts = Object.create(null);
  function noteLocalUpsert(coll, id) {
    if (!coll || !id) return;
    recentLocalUpserts[coll + ':' + id] = Date.now();
  }
  function isRecentLocalUpsert(coll, id) {
    const ts = recentLocalUpserts[coll + ':' + id];
    if (!ts) return false;
    if (Date.now() - ts > 15000) {
      delete recentLocalUpserts[coll + ':' + id];
      return false;
    }
    return true;
  }

  async function getAppSetting(key) {
    if (!sb || !sb.isConfigured() || !key) return null;
    try {
      const client = sb.getClient && sb.getClient();
      if (!client) return null;
      const res = await (sb.withRetry ? sb.withRetry(async () => {
        const { data, error } = await client.from('app_settings').select('value, updatedAt').eq('key', String(key)).maybeSingle();
        if (error) {
          if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
          return { data: null, error };
        }
        return { data, error: null };
      }) : client.from('app_settings').select('value, updatedAt').eq('key', String(key)).maybeSingle());
      if (res && res.data && res.data.value !== undefined) return res.data.value;
      return null;
    } catch (e) {
      console.warn('[syncSb] getAppSetting failed for', key, e && e.message);
      return null;
    }
  }

  async function setAppSetting(key, value) {
    if (!sb || !sb.isConfigured() || !key) return { ok: false, message: 'Supabase not configured' };
    try {
      const client = sb.getClient && sb.getClient();
      if (!client) return { ok: false, message: 'No Supabase client' };
      const nowIso = new Date().toISOString();
      const exec = async () => {
        const { error } = await client
          .from('app_settings')
          .upsert({ key: String(key), value: value, updatedAt: nowIso }, { onConflict: 'key' });
        if (error) {
          if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
          return { ok: false, error, message: error.message };
        }
        return { ok: true };
      };
      return await (sb.withRetry ? sb.withRetry(exec) : exec());
    } catch (e) {
      console.warn('[syncSb] setAppSetting failed for', key, e && e.message);
      return { ok: false, error: e, message: (e && e.message) || 'Failed to save setting' };
    }
  }

  /* Fallback persistence for subtasks (tasks & maintenance) in app_settings when the remote
     Supabase table does not yet have a `subtasks` JSONB column. */
  const subtasksFallbackCache = { tasks: null, maintenance: null };
  function subtasksSettingKey(coll) {
    return coll === 'maintenance' ? 'rmtp_subtasks_maintenance' : 'rmtp_subtasks_tasks';
  }
  async function loadSubtasksFallbackMap(coll) {
    if (coll !== 'tasks' && coll !== 'maintenance') return {};
    if (!sb || !sb.isConfigured()) return {};
    const remoteVal = await getAppSetting(subtasksSettingKey(coll));
    const map = (remoteVal && typeof remoteVal === 'object' && !Array.isArray(remoteVal)) ? remoteVal : {};
    subtasksFallbackCache[coll] = map;
    return map;
  }
  async function persistSubtasksFallbackEntry(coll, recordId, subtasksList) {
    if ((coll !== 'tasks' && coll !== 'maintenance') || !recordId) return;
    if (!sb || !sb.isConfigured()) return;
    try {
      const current = subtasksFallbackCache[coll]
        ? { ...subtasksFallbackCache[coll] }
        : { ...(await loadSubtasksFallbackMap(coll)) };
      const normalized = Array.isArray(subtasksList) ? subtasksList : [];
      if (normalized.length > 0) {
        current[String(recordId)] = {
          subtasks: normalized,
          updatedAt: Date.now(),
        };
      } else {
        delete current[String(recordId)];
      }
      subtasksFallbackCache[coll] = current;
      await setAppSetting(subtasksSettingKey(coll), current);
    } catch (e) {
      console.warn('[syncSb] Subtasks fallback persistence skipped for', coll, e && e.message);
    }
  }

  let unsupportedTables = {};
  try {
    const savedT = localStorage.getItem('rmtp_unsupported_tables');
    if (savedT) unsupportedTables = JSON.parse(savedT);
    // Heal previously poisoned core tables that were falsely marked missing due to PGRST204 column cache errors
    let healed = false;
    ['bookings', 'availability', 'advancing', 'tasks', 'dcps', 'procedures'].forEach((t) => {
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

  /* ---- Resilient Availability Persistence (Dual-Backend + Pending Queue) ----
     Primary backend: `public.availability` table.
     Automatic fallback: if `public.availability` has not yet been created in Supabase
     (PGRST205 / 42P01), seamlessly persists one row per record in `public.app_settings`
     under key `availability:<id>`, and auto-migrates back into `public.availability`
     the moment that table exists — zero data loss and immediate DB persistence. */
  const AVAIL_QUEUE_KEY = 'rmtp_pending_availability';
  const AVAIL_MIGRATED_KEY = 'rmtp_avail_cloud_migrated';
  const AVAIL_SETTINGS_PREFIX = 'availability:';
  let availBackend = 'unknown'; // 'unknown' | 'table' | 'app_settings'
  let availLegacyChecked = false;
  let availDrainInFlight = null;

  function normalizeAvailRecord(rec) {
    if (!rec || !rec.id) return null;
    const rawDate = String(rec.date || '').trim();
    const dateStr = rawDate.length >= 10 ? rawDate.slice(0, 10) : rawDate;
    return {
      id: String(rec.id),
      userId: String(rec.userId || ''),
      userName: String(rec.userName || ''),
      date: dateStr,
      type: rec.type === 'unavailable' ? 'unavailable' : 'available',
      dayPart: String(rec.dayPart || 'all_day'),
      startTime: String(rec.startTime || ''),
      finishTime: String(rec.finishTime || ''),
      notes: String(rec.notes || ''),
      updatedAt: rec.updatedAt ? String(rec.updatedAt) : new Date().toISOString(),
    };
  }

  function parseTimestampMs(val) {
    if (!val) return 0;
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    const n = Number(val);
    if (isFinite(n) && n > 0) return n;
    const parsed = Date.parse(String(val));
    return isNaN(parsed) ? 0 : parsed;
  }

  function readAvailQueue() {
    try {
      const raw = localStorage.getItem(AVAIL_QUEUE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeAvailQueue(q) {
    try {
      if (!q || !Object.keys(q).length) {
        localStorage.removeItem(AVAIL_QUEUE_KEY);
      } else {
        localStorage.setItem(AVAIL_QUEUE_KEY, JSON.stringify(q));
      }
    } catch (e) {
      console.warn('[syncSb] Failed to persist availability queue', e);
    }
  }

  function enqueueAvailOp(op, id, record) {
    if (!id) return 0;
    const q = readAvailQueue();
    const prev = q[id];
    const ts = Math.max(Date.now(), prev && prev.ts ? prev.ts + 1 : 0);
    q[id] = op === 'delete'
      ? { op: 'delete', id: String(id), ts }
      : { op: 'upsert', id: String(id), record: normalizeAvailRecord(record), ts };
    writeAvailQueue(q);
    return ts;
  }

  function dequeueAvailOps(entries) {
    if (!entries || !entries.length) return;
    const q = readAvailQueue();
    let changed = false;
    entries.forEach(({ id, ts }) => {
      if (q[id] && q[id].ts === ts) {
        delete q[id];
        changed = true;
      }
    });
    if (changed) writeAvailQueue(q);
  }

  function stripUnsupportedAvailCols(row) {
    const table = tables().availability || 'availability';
    const out = { ...row };
    if (unsupportedCols[table]) {
      Object.keys(unsupportedCols[table]).forEach((col) => {
        if (unsupportedCols[table][col]) delete out[col];
      });
    }
    return out;
  }

  async function upsertAvailToTable(rows, attempt) {
    const table = tables().availability || 'availability';
    const client = sb.getClient && sb.getClient();
    if (!client) return { ok: false, message: 'Supabase client unavailable' };
    const cleanRows = rows.map(stripUnsupportedAvailCols);
    const exec = async () => {
      const { error } = await client.from(table).upsert(cleanRows, { onConflict: 'id' });
      if (error) {
        if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
        return { ok: false, error, message: error.message };
      }
      return { ok: true };
    };
    const res = sb.withRetry ? await sb.withRetry(exec) : await exec();
    if (res && res.ok) {
      availBackend = 'table';
      clearTableUnsupported(table);
      return res;
    }
    if (res && res.error && (res.error.code === 'PGRST204' || res.error.code === '42703')) {
      const missingCol = extractMissingColumn(res.error);
      if (missingCol && (attempt || 0) < 12) {
        markColumnUnsupported(table, missingCol);
        return upsertAvailToTable(rows, (attempt || 0) + 1);
      }
    }
    return res || { ok: false, message: 'Unknown upsert error' };
  }

  async function upsertAvailToAppSettings(rows) {
    const client = sb.getClient && sb.getClient();
    if (!client) return { ok: false, message: 'Supabase client unavailable' };
    const nowIso = new Date().toISOString();
    const settingsRows = rows.map((r) => ({
      key: AVAIL_SETTINGS_PREFIX + r.id,
      value: r,
      updatedAt: r.updatedAt || nowIso,
    }));
    const exec = async () => {
      const { error } = await client.from('app_settings').upsert(settingsRows, { onConflict: 'key' });
      if (error) {
        if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
        return { ok: false, error, message: error.message };
      }
      return { ok: true };
    };
    const res = sb.withRetry ? await sb.withRetry(exec) : await exec();
    if (res && res.ok) availBackend = 'app_settings';
    return res || { ok: false, message: 'Failed writing availability to app_settings' };
  }

  async function pushAvailRowsRemote(rows) {
    if (!rows || !rows.length) return { ok: true };
    const normalized = rows.map(normalizeAvailRecord).filter(Boolean);
    if (!normalized.length) return { ok: true };

    // Chunk large bulk writes into groups of 50 rows for reliability
    const CHUNK = 50;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const slice = normalized.slice(i, i + CHUNK);
      if (availBackend !== 'app_settings') {
        const res = await upsertAvailToTable(slice, 0);
        if (res && res.ok) continue;
        if (res && res.error && isTableMissingError(res.error)) {
          availBackend = 'app_settings';
        } else {
          return res;
        }
      }
      const fbRes = await upsertAvailToAppSettings(slice);
      if (!fbRes || !fbRes.ok) return fbRes;
    }
    return { ok: true };
  }

  async function deleteAvailIdsRemote(ids) {
    if (!ids || !ids.length) return { ok: true };
    const client = sb.getClient && sb.getClient();
    if (!client) return { ok: false, message: 'Supabase client unavailable' };
    const table = tables().availability || 'availability';

    if (availBackend !== 'app_settings') {
      const execTable = async () => {
        const { error } = await client.from(table).delete().in('id', ids);
        if (error) {
          if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
          return { ok: false, error, message: error.message };
        }
        return { ok: true };
      };
      const res = sb.withRetry ? await sb.withRetry(execTable) : await execTable();
      if (res && res.ok) {
        availBackend = 'table';
        // Also remove any stale app_settings copy silently so it never resurrects
        client.from('app_settings').delete().in('key', ids.map((id) => AVAIL_SETTINGS_PREFIX + id)).then(() => {}, () => {});
        return { ok: true };
      }
      if (res && res.error && isTableMissingError(res.error)) {
        availBackend = 'app_settings';
      } else {
        return res;
      }
    }

    const keys = ids.map((id) => AVAIL_SETTINGS_PREFIX + id);
    const execFallback = async () => {
      const { error } = await client.from('app_settings').delete().in('key', keys);
      if (error) {
        if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
        return { ok: false, error, message: error.message };
      }
      return { ok: true };
    };
    const fbRes = sb.withRetry ? await sb.withRetry(execFallback) : await execFallback();
    if (fbRes && fbRes.ok) availBackend = 'app_settings';
    return fbRes || { ok: false, message: 'Failed deleting availability from app_settings' };
  }

  async function fetchAvailFromAppSettings() {
    const client = sb.getClient && sb.getClient();
    if (!client) return [];
    const exec = async () => {
      const { data, error } = await client
        .from('app_settings')
        .select('key, value, updatedAt')
        .like('key', AVAIL_SETTINGS_PREFIX + '%');
      if (error) {
        if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
        throw error;
      }
      return data || [];
    };
    const raw = sb.withRetry ? await sb.withRetry(exec) : await exec();
    return raw.map((row) => {
      const val = (row && row.value && typeof row.value === 'object') ? row.value : {};
      const id = val.id || String(row.key || '').slice(AVAIL_SETTINGS_PREFIX.length);
      return normalizeAvailRecord(Object.assign({}, val, {
        id,
        updatedAt: val.updatedAt || row.updatedAt || '',
      }));
    }).filter(Boolean);
  }

  async function fetchRemoteAvailability() {
    const table = tables().availability || 'availability';
    if (availBackend !== 'app_settings') {
      try {
        const tableRows = (await sb.selectAll(table)).map(normalizeAvailRecord).filter(Boolean);
        availBackend = 'table';
        clearTableUnsupported(table);

        // One-time lossless migration: if records were previously saved into app_settings
        // before public.availability existed, promote them into public.availability now.
        if (!availLegacyChecked) {
          availLegacyChecked = true;
          try {
            const legacyRows = await fetchAvailFromAppSettings();
            if (legacyRows.length) {
              const byId = new Map(tableRows.map((r) => [r.id, r]));
              const toPromote = [];
              legacyRows.forEach((lr) => {
                const existing = byId.get(lr.id);
                if (!existing || parseTimestampMs(lr.updatedAt) > parseTimestampMs(existing.updatedAt)) {
                  byId.set(lr.id, lr);
                  toPromote.push(lr);
                }
              });
              if (toPromote.length) {
                const migRes = await upsertAvailToTable(toPromote, 0);
                if (migRes && migRes.ok) {
                  const client = sb.getClient && sb.getClient();
                  if (client) {
                    const keys = legacyRows.map((lr) => AVAIL_SETTINGS_PREFIX + lr.id);
                    client.from('app_settings').delete().in('key', keys).then(() => {}, () => {});
                  }
                }
              }
              return { ok: true, backend: 'table', rows: Array.from(byId.values()) };
            }
          } catch (migErr) {
            console.warn('[syncSb] Legacy availability migration check skipped:', migErr && migErr.message);
          }
        }
        return { ok: true, backend: 'table', rows: tableRows };
      } catch (err) {
        if (isTableMissingError(err)) {
          availBackend = 'app_settings';
        } else {
          throw err;
        }
      }
    }

    const fallbackRows = await fetchAvailFromAppSettings();
    availBackend = 'app_settings';
    return { ok: true, backend: 'app_settings', rows: fallbackRows };
  }

  async function drainAvailabilityQueue() {
    if (!sb || !sb.isConfigured()) return { ok: true, flushed: 0, remaining: 0, backend: 'local' };
    if (availDrainInFlight) return availDrainInFlight;

    availDrainInFlight = (async () => {
      const q = readAvailQueue();
      const entries = Object.values(q);
      if (!entries.length) {
        return { ok: true, flushed: 0, remaining: 0, backend: availBackend };
      }

      const upserts = entries.filter((e) => e && e.op === 'upsert' && e.record);
      const deletes = entries.filter((e) => e && e.op === 'delete' && e.id);
      let flushed = 0;

      try {
        if (upserts.length) {
          const res = await pushAvailRowsRemote(upserts.map((u) => u.record));
          if (res && res.ok) {
            dequeueAvailOps(upserts.map((u) => ({ id: u.id, ts: u.ts })));
            flushed += upserts.length;
          } else {
            console.warn('[syncSb] Availability batch upsert deferred (will retry):', res && (res.message || res.error));
          }
        }
        if (deletes.length) {
          const res = await deleteAvailIdsRemote(deletes.map((d) => d.id));
          if (res && res.ok) {
            dequeueAvailOps(deletes.map((d) => ({ id: d.id, ts: d.ts })));
            flushed += deletes.length;
          } else {
            console.warn('[syncSb] Availability batch delete deferred (will retry):', res && (res.message || res.error));
          }
        }
      } catch (err) {
        console.warn('[syncSb] Availability queue drain error (will retry):', err && err.message);
      }

      const remaining = Object.keys(readAvailQueue()).length;
      return { ok: remaining === 0, flushed, remaining, backend: availBackend };
    })();

    try {
      return await availDrainInFlight;
    } finally {
      availDrainInFlight = null;
    }
  }

  function dedupeAvailabilityByUserDate(list) {
    const bySlot = new Map();
    const out = [];
    list.forEach((rec) => {
      if (!rec || !rec.id) return;
      if (!rec.userId || !rec.date) {
        out.push(rec);
        return;
      }
      const slot = rec.userId + '::' + rec.date;
      const prev = bySlot.get(slot);
      if (!prev || parseTimestampMs(rec.updatedAt) >= parseTimestampMs(prev.updatedAt)) {
        bySlot.set(slot, rec);
      }
    });
    bySlot.forEach((v) => out.push(v));
    return out;
  }

  async function pullAvailabilityCollection() {
    // 1. Flush any locally queued availability changes first so remote reflects latest local writes
    await drainAvailabilityQueue();

    let fetched;
    try {
      fetched = await fetchRemoteAvailability();
    } catch (err) {
      if (sb.isClockSkewError && sb.isClockSkewError(err)) {
        console.warn('[syncSb] Clock skew on availability, retaining local data until next sync.');
        return;
      }
      console.error('[syncSb] pull failed for availability', err);
      return;
    }

    const remoteRows = (fetched && Array.isArray(fetched.rows)) ? fetched.rows : [];
    const localList = (store.all('availability') || []).map(normalizeAvailRecord).filter(Boolean);
    const pending = readAvailQueue();
    const migratedBefore = (() => {
      try { return localStorage.getItem(AVAIL_MIGRATED_KEY) === '1'; } catch (e) { return false; }
    })();

    const mergedById = new Map();
    const localById = new Map(localList.map((r) => [r.id, r]));
    const staleRemoteDeletes = [];

    remoteRows.forEach((r) => {
      const pend = pending[r.id];
      if (pend && pend.op === 'delete') {
        staleRemoteDeletes.push(r.id);
        return;
      }
      if (store.isDeleted && store.isDeleted('availability', r.id)) {
        staleRemoteDeletes.push(r.id);
        return;
      }
      if (pend && pend.op === 'upsert' && pend.record) {
        if (parseTimestampMs(pend.record.updatedAt) >= parseTimestampMs(r.updatedAt)) {
          mergedById.set(r.id, pend.record);
          return;
        }
      }
      const loc = localById.get(r.id);
      if (loc && parseTimestampMs(loc.updatedAt) > parseTimestampMs(r.updatedAt) && pend && pend.op === 'upsert') {
        mergedById.set(r.id, loc);
        return;
      }
      mergedById.set(r.id, r);
    });

    // Preserve any still-pending local upserts (e.g., created while offline)
    Object.values(pending).forEach((entry) => {
      if (entry && entry.op === 'upsert' && entry.record && !mergedById.has(entry.id)) {
        mergedById.set(entry.id, entry.record);
      }
    });

    // One-time safe migration: push any pre-existing local-only availability rows
    // that were saved in localStorage before availability DB persistence was active.
    const toMigrateUp = [];
    if (!migratedBefore) {
      localList.forEach((loc) => {
        if (!loc || !loc.id) return;
        if (store.isDeleted && store.isDeleted('availability', loc.id)) return;
        if (pending[loc.id] && pending[loc.id].op === 'delete') return;
        const remoteMatch = mergedById.get(loc.id);
        if (!remoteMatch || parseTimestampMs(loc.updatedAt) > parseTimestampMs(remoteMatch.updatedAt)) {
          mergedById.set(loc.id, loc);
          toMigrateUp.push(loc);
        }
      });
    }

    const finalRows = dedupeAvailabilityByUserDate(Array.from(mergedById.values()));

    // Only emit store.write if the collection actually changed
    const prevJson = JSON.stringify(localList);
    const nextJson = JSON.stringify(finalRows);
    if (prevJson !== nextJson) {
      store.write('availability', finalRows);
    }

    if (staleRemoteDeletes.length) {
      deleteAvailIdsRemote(staleRemoteDeletes).catch(() => {});
    }

    if (!migratedBefore) {
      if (toMigrateUp.length) {
        const res = await pushAvailRowsRemote(toMigrateUp);
        if (res && res.ok) {
          try { localStorage.setItem(AVAIL_MIGRATED_KEY, '1'); } catch (e) {}
        } else {
          // Queue them so they persist as soon as connectivity/auth is ready
          toMigrateUp.forEach((rec) => enqueueAvailOp('upsert', rec.id, rec));
        }
      } else {
        try { localStorage.setItem(AVAIL_MIGRATED_KEY, '1'); } catch (e) {}
      }
    }
  }

  /* ---- Procedures Grouping & Sync (Flat DB rows <-> Grouped UI categories) ----
     Supabase `public.procedures` stores one flat row per SOP:
       { id, category, title, body, icon }
     while the app UI renders grouped categories:
       { id, name, icon, items: [{ id, title, body, updated }] }. */
  function procSlug(str) {
    if (RMTP.slug) return RMTP.slug(str);
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
  }

  function cloneSeedProcedures() {
    const seed = (RMTP.seed && Array.isArray(RMTP.seed.procedures)) ? RMTP.seed.procedures : [];
    return seed.map((c) => ({
      id: c.id || procSlug(c.name),
      name: c.name || 'General',
      icon: c.icon || 'book',
      items: Array.isArray(c.items) ? c.items.map((it) => ({
        id: it.id,
        title: it.title || 'Untitled procedure',
        body: it.body || '',
        updated: it.updated || '',
      })) : [],
    }));
  }

  function normalizeProcedureGroups(rawList) {
    const list = Array.isArray(rawList) ? rawList : [];
    const seedCats = (RMTP.seed && Array.isArray(RMTP.seed.procedures)) ? RMTP.seed.procedures : [];
    const seedCatByName = new Map();
    const seedOrder = new Map();
    seedCats.forEach((sc, idx) => {
      const nm = String(sc.name || '').trim().toLowerCase();
      if (nm) {
        seedCatByName.set(nm, { id: sc.id, name: sc.name, icon: sc.icon || 'book' });
        seedOrder.set(sc.id, idx);
      }
    });

    const groupsById = new Map();
    const groupOrder = [];

    function ensureGroup(name, preferredId, icon) {
      const cleanName = String(name || '').trim();
      if (!cleanName) return null;
      const seedMatch = seedCatByName.get(cleanName.toLowerCase());
      const catId = (seedMatch && seedMatch.id) || preferredId || procSlug(cleanName);
      let g = groupsById.get(catId);
      if (!g) {
        // Also match by case-insensitive name to prevent duplicates
        for (const existing of groupsById.values()) {
          if (existing.name.toLowerCase() === cleanName.toLowerCase()) {
            g = existing;
            break;
          }
        }
      }
      if (!g) {
        g = {
          id: catId,
          name: (seedMatch && seedMatch.name) || cleanName,
          icon: icon || (seedMatch && seedMatch.icon) || 'book',
          items: [],
          _itemMap: new Map(),
        };
        groupsById.set(g.id, g);
        groupOrder.push(g.id);
      } else if (!g.icon && icon) {
        g.icon = icon;
      }
      return g;
    }

    function addItemToGroup(g, item) {
      if (!g || !item || !item.id) return;
      const title = String(item.title || '').trim();
      if (!title) return;
      const normItem = {
        id: String(item.id),
        title,
        body: item.body != null ? String(item.body) : '',
        updated: item.updated ? String(item.updated) : '',
      };
      const prev = g._itemMap.get(normItem.id);
      if (!prev) {
        g._itemMap.set(normItem.id, normItem);
        g.items.push(normItem);
      } else {
        // Prefer richer body or newer updated timestamp
        const prevBody = (prev.body || '').trim();
        const nextBody = (normItem.body || '').trim();
        if (nextBody && (!prevBody || parseTimestampMs(normItem.updated) >= parseTimestampMs(prev.updated))) {
          prev.title = normItem.title;
          prev.body = normItem.body;
          if (normItem.updated) prev.updated = normItem.updated;
        }
      }
    }

    list.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      // Case 1: Already a grouped category { id, name, icon, items: [...] }
      if (Array.isArray(entry.items)) {
        const catName = String(entry.name || entry.category || '').trim();
        if (!catName) return;
        const g = ensureGroup(catName, entry.id, entry.icon);
        entry.items.forEach((it) => addItemToGroup(g, it));
        return;
      }
      // Case 2: Flat Supabase SOP row { id, category, title, body, icon }
      const title = String(entry.title || '').trim();
      const catName = String(entry.category || entry.name || '').trim();
      if (!title) {
        // Skip corrupted/stub category rows written by legacy sync (no title and no items)
        return;
      }
      const g = ensureGroup(catName || 'General', null, entry.icon);
      addItemToGroup(g, {
        id: entry.id,
        title,
        body: entry.body || '',
        updated: entry.updated || entry.updatedAt || '',
      });
    });

    const out = groupOrder.map((id) => {
      const g = groupsById.get(id);
      return { id: g.id, name: g.name, icon: g.icon || 'book', items: g.items };
    });

    // Keep familiar canonical ordering for known seed categories while preserving custom ones after
    out.sort((a, b) => {
      const oa = seedOrder.has(a.id) ? seedOrder.get(a.id) : 999;
      const ob = seedOrder.has(b.id) ? seedOrder.get(b.id) : 999;
      if (oa !== ob) return oa - ob;
      return 0;
    });

    return out;
  }

  RMTP.normalizeProcedures = normalizeProcedureGroups;

  function flattenProcedureCategory(cat) {
    if (!cat || !Array.isArray(cat.items)) return [];
    const catName = String(cat.name || 'General').trim() || 'General';
    const icon = String(cat.icon || 'book');
    return cat.items
      .filter((it) => it && it.id && String(it.title || '').trim())
      .map((it) => ({
        id: String(it.id),
        category: catName,
        title: String(it.title || '').trim(),
        body: it.body != null ? String(it.body) : '',
        icon,
      }));
  }

  async function pullProceduresCollection() {
    const table = tables().procedures || 'procedures';
    let rows = [];
    try {
      rows = await sb.selectAll(table);
      clearTableUnsupported(table);
    } catch (err) {
      if (sb.isClockSkewError && sb.isClockSkewError(err)) {
        console.warn('[syncSb] Clock skew on procedures, retaining local data until next sync.');
        return;
      }
      if (isTableMissingError(err)) {
        console.warn('[syncSb] Procedures table missing in Supabase; falling back to built-in procedures.');
        const current = normalizeProcedureGroups(store.all('procedures'));
        if (!current.length) store.write('procedures', cloneSeedProcedures());
        return;
      }
      console.error('[syncSb] pull failed for procedures', err);
      const current = normalizeProcedureGroups(store.all('procedures'));
      if (!current.length) store.write('procedures', cloneSeedProcedures());
      return;
    }

    const filteredRemote = (Array.isArray(rows) ? rows : []).filter((r) => {
      if (!r || !r.id) return false;
      if (store.isDeleted && store.isDeleted('procedures', r.id)) {
        if (sb && sb.deleteRow) sb.deleteRow(table, r.id).catch(() => {});
        return false;
      }
      return true;
    });

    let grouped = normalizeProcedureGroups(filteredRemote);
    const totalItems = grouped.reduce((n, g) => n + (g.items ? g.items.length : 0), 0);

    // If Supabase `procedures` table is empty (not yet populated), fall back to built-in seed SOPs
    // so every permitted user group (including Freelancers) sees procedures instead of a blank page.
    if (!grouped.length || totalItems === 0) {
      const localNorm = normalizeProcedureGroups(store.all('procedures'));
      const localItems = localNorm.reduce((n, g) => n + (g.items ? g.items.length : 0), 0);
      grouped = localItems > 0 ? localNorm : cloneSeedProcedures();
    } else {
      // Preserve any locally created empty category tabs that aren't deleted
      const localNorm = normalizeProcedureGroups(store.all('procedures'));
      const existingIds = new Set(grouped.map((g) => g.id));
      localNorm.forEach((lg) => {
        if (lg && lg.id && lg.name && !existingIds.has(lg.id) && !(store.isDeleted && store.isDeleted('procedures', lg.id))) {
          if (!lg.items || lg.items.length === 0) {
            grouped.push(lg);
            existingIds.add(lg.id);
          }
        }
      });
    }

    const prevJson = JSON.stringify(store.all('procedures') || []);
    const nextJson = JSON.stringify(grouped);
    if (prevJson !== nextJson) {
      store.write('procedures', grouped);
    }
  }

  async function pullCollection(coll) {
    const table = tables()[coll]; if (!table) return;
    if (coll === 'availability') {
      return pullAvailabilityCollection();
    }
    if (coll === 'procedures') {
      return pullProceduresCollection();
    }
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

    const remoteIds = new Set();
    const suppressedSet = (coll === 'advancing' && RMTP.artifax && typeof RMTP.artifax.getSuppressedIdSet === 'function')
      ? RMTP.artifax.getSuppressedIdSet()
      : null;

    let mutated = false;
    rows.forEach((r) => {
      if (!r || r.id == null) return;
      remoteIds.add(r.id);

      // 0. If this is an Artifax event suppressed in the database, never allow it back into active advancing
      if (coll === 'advancing' && suppressedSet && suppressedSet.size > 0) {
        const aid = String(r.artifaxId || (String(r.id).startsWith('evt-afx-') ? String(r.id).slice(8) : '')).trim();
        const baseAid = aid.includes('__') ? aid.split('__')[0] : aid;
        if (suppressedSet.has(r.id) || (aid && suppressedSet.has(aid)) || (baseAid && suppressedSet.has(baseAid))) {
          if (byId.has(r.id)) {
            byId.delete(r.id);
            mutated = true;
          }
          if (sb && sb.deleteRow) {
            sb.deleteRow(table, r.id).catch(() => {});
          }
          return;
        }
      }

      // 0b. If this is a Pre-Screening record dismissed from the tracker, never allow it back in
      if (coll === 'dcps' && RMTP.dcpEngine && typeof RMTP.dcpEngine.isDcpRowDismissed === 'function') {
        if (RMTP.dcpEngine.isDcpRowDismissed(r)) {
          if (byId.has(r.id)) {
            byId.delete(r.id);
            mutated = true;
          }
          if (sb && sb.deleteRow) {
            sb.deleteRow(table, r.id).catch(() => {});
          }
          return;
        }
      }

      // 1. If this record was explicitly deleted by the user, DO NOT restore it on refresh!
      if (store.isDeleted && store.isDeleted(coll, r.id)) {
        if (byId.has(r.id)) {
          byId.delete(r.id);
          mutated = true;
        }
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
        const localTime = Date.parse(existing.updatedAt || existing.createdAt || '') || Number(existing.updatedAt || existing.createdAt || 0) || 0;
        const remoteTime = Date.parse(r.updatedAt || r.createdAt || '') || Number(r.updatedAt || r.createdAt || 0) || 0;
        if (localTime > remoteTime && existing.status === 'Completed' && r.status !== 'Completed') {
          r.status = existing.status;
          r.completedAt = existing.completedAt;
          r.completedBy = existing.completedBy;
        }
        if (existing.hiresMeta && !r.hiresMeta) {
          r.hiresMeta = existing.hiresMeta;
        }
        if (Array.isArray(existing.subtasks) && existing.subtasks.length) {
          if (!Array.isArray(r.subtasks) || !r.subtasks.length || localTime > remoteTime) {
            r.subtasks = existing.subtasks;
          }
        }
      } else if (coll === 'maintenance' && existing) {
        const localTime = Date.parse(existing.updatedAt || '') || Number(existing.updatedAt || existing.createdAt || 0) || 0;
        const remoteTime = Date.parse(r.updatedAt || '') || Number(r.updatedAt || r.createdAt || 0) || 0;
        if (Array.isArray(existing.subtasks) && existing.subtasks.length) {
          if (!Array.isArray(r.subtasks) || !r.subtasks.length || localTime > remoteTime) {
            r.subtasks = existing.subtasks;
          }
        }
      } else if (coll === 'dcps' && existing) {
        // Timestamp-aware QC merge: never wipe fresher local QC progress or criteria on pull
        const localUpdated = Date.parse(existing.updatedAt || '') || 0;
        const remoteUpdated = Date.parse(r.updatedAt || '') || 0;
        const localWins = (localUpdated > remoteUpdated) || (existing.tested && !r.tested && !remoteUpdated);
        if (localWins) {
          const qcKeys = [
            'qc_criteria', 'tested', 'outcome',
            'mediaReceived', 'kdmCplReceived', 'playlistMade', 'subsAudioSync', 'holdingSlidesReady',
            'issuesNoted', 'furtherAction', 'hasFurtherAction',
            'testedByUserId', 'testedByUserName', 'testDateTime',
            'linkedTaskId', 'lastReportId', 'reportGeneratedAt',
            'mediaType', 'duration', 'notes', 'updatedAt'
          ];
          qcKeys.forEach((k) => {
            if (existing[k] !== undefined) r[k] = existing[k];
          });
        } else {
          if (!r.qc_criteria && existing.qc_criteria) r.qc_criteria = existing.qc_criteria;
          if (!r.linkedTaskId && existing.linkedTaskId) r.linkedTaskId = existing.linkedTaskId;
        }
        // Preserve runtime consolidation metadata derived from Advancing
        if (Array.isArray(existing.linkedEventIds) && existing.linkedEventIds.length && !Array.isArray(r.linkedEventIds)) {
          r.linkedEventIds = existing.linkedEventIds;
        }
        if (existing.slotKey && !r.slotKey) {
          r.slotKey = existing.slotKey;
        }
      }

      if (!byId.has(r.id)) order.push(r.id);
      byId.set(r.id, r);
      mutated = true;
    });

    // Authoritative remote-deletion pruning for synced operational tables:
    // If a row was deleted from Supabase (e.g., Artifax reconciliation or portal delete on another device),
    // prune it from the local cache so stale/cancelled events never linger in localStorage!
    if (coll === 'advancing' || coll === 'bookings' || coll === 'dcps') {
      for (const localId of Array.from(byId.keys())) {
        if (!remoteIds.has(localId) && !isRecentLocalUpsert(coll, localId)) {
          byId.delete(localId);
          mutated = true;
        }
      }
    }

    if (coll === 'tasks' || coll === 'maintenance') {
      try {
        const fallbackMap = await loadSubtasksFallbackMap(coll);
        if (fallbackMap && typeof fallbackMap === 'object') {
          Object.keys(fallbackMap).forEach((recId) => {
            const entry = fallbackMap[recId];
            const fbList = Array.isArray(entry) ? entry : (entry && Array.isArray(entry.subtasks) ? entry.subtasks : null);
            const fbTime = (entry && Number(entry.updatedAt)) || 0;
            if (!fbList || !fbList.length) return;
            const rec = byId.get(recId);
            if (!rec) return;
            const recTime = Date.parse(rec.updatedAt || '') || Number(rec.updatedAt || 0) || 0;
            if (!Array.isArray(rec.subtasks) || !rec.subtasks.length || (fbTime > recTime && !isRecentLocalUpsert(coll, recId))) {
              rec.subtasks = fbList;
              mutated = true;
            }
          });
        }
      } catch (e) {}
    }

    if (mutated) {
      const nextList = order.filter((id) => byId.has(id)).map((id) => byId.get(id));
      store.write(coll, nextList);
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
        // Hydrate DB-persisted Artifax suppression list & DCP tracker dismissals BEFORE pulling
        // so suppressed/dismissed rows are filtered immediately on first load.
        if (RMTP.artifax && typeof RMTP.artifax.hydrateFromDb === 'function') {
          await RMTP.artifax.hydrateFromDb().catch(() => {});
        }
        if (RMTP.dcpEngine && typeof RMTP.dcpEngine.hydrateDismissalsFromDb === 'function') {
          await RMTP.dcpEngine.hydrateDismissalsFromDb().catch(() => {});
        }
        await Promise.allSettled([
          ...COLLS.map((c) => pullCollection(c)),
          (RMTP.auth && typeof RMTP.auth.pullTechTags === 'function')
            ? RMTP.auth.pullTechTags().catch(() => {})
            : Promise.resolve(),
        ]);
        if (RMTP.syncAdvancingToDcps && typeof RMTP.syncAdvancingToDcps === 'function') {
          try { RMTP.syncAdvancingToDcps(); } catch (e) {}
        }
      } catch (err) {
        console.error('[syncSb] pull error', err);
      } finally {
        pullInFlight = null;
      }
    })();
    return pullInFlight;
  }

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    const origUpsert = store.upsert, origRemove = store.remove;
    store.upsert = function (name, record) {
      if (name === 'availability') {
        const norm = normalizeAvailRecord(record) || record;
        if (norm && norm.id && store.unmarkDeleted) {
          store.unmarkDeleted('availability', norm.id);
        }
        const res = origUpsert(name, norm);
        if (sb && sb.isConfigured() && norm && norm.id) {
          const ts = enqueueAvailOp('upsert', norm.id, norm);
          pushAvailRowsRemote([norm]).then((result) => {
            if (result && result.ok) {
              dequeueAvailOps([{ id: norm.id, ts }]);
            } else {
              console.warn('[syncSb] Availability upsert queued for retry:', result && (result.message || result.error));
            }
          }).catch((e) => {
            console.warn('[syncSb] Availability upsert queued for retry:', e && e.message);
          });
        }
        return res;
      }

      if (name === 'procedures') {
        const res = origUpsert(name, record);
        if (sb && sb.isConfigured() && record) {
          const table = tables().procedures || 'procedures';
          const flatRows = Array.isArray(record.items)
            ? flattenProcedureCategory(record)
            : (record.id && record.title ? [{
                id: String(record.id),
                category: String(record.category || record.name || 'General'),
                title: String(record.title),
                body: record.body != null ? String(record.body) : '',
                icon: String(record.icon || 'book'),
              }] : []);
          if (flatRows.length) {
            const client = sb.getClient && sb.getClient();
            if (client) {
              const exec = async () => {
                const { error } = await client.from(table).upsert(flatRows, { onConflict: 'id' });
                if (error) {
                  if (sb.isClockSkewError && sb.isClockSkewError(error)) throw error;
                  console.warn('[syncSb] Procedures upsert skipped:', error.message);
                }
              };
              (sb.withRetry ? sb.withRetry(exec) : exec()).catch((e) => console.warn('[syncSb] Procedures upsert error:', e));
            }
          }
        }
        return res;
      }

      if (name === 'dcps' && record && record.id && store.unmarkDeleted) {
        store.unmarkDeleted('dcps', record.id);
      }
      const res = origUpsert(name, record);
      if (record && record.id) noteLocalUpsert(name, record.id);
      
      if (sb && sb.isConfigured() && COLLS.includes(name)) {
        const table = tables()[name];
        if (!isTableUnsupported(table)) {
           const payload = { ...record };

           // Strip runtime-only DCP consolidation metadata from Supabase wire payload
           // (kept on local record and deterministically recomputed from Advancing)
           if (name === 'dcps') {
             delete payload.linkedEventIds;
             delete payload.slotKey;
           }

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

           if ((name === 'tasks' || name === 'maintenance') && isColumnUnsupported(table, 'subtasks') && record && record.id) {
             persistSubtasksFallbackEntry(name, record.id, Array.isArray(record.subtasks) ? record.subtasks : []).catch(() => {});
           }
           
           const attemptUpsert = async (currentPayload, attempt) => {
             const result = await sb.upsertRow(table, currentPayload);
             if (!result || result.ok) return;
             if (result.error && (result.error.code === 'PGRST204' || result.error.code === '42703')) {
               const missingCol = extractMissingColumn(result.error);
               if (missingCol && attempt < 15 && Object.prototype.hasOwnProperty.call(currentPayload, missingCol)) {
                 markColumnUnsupported(table, missingCol);
                 if (missingCol === 'subtasks' && (name === 'tasks' || name === 'maintenance') && record && record.id) {
                   persistSubtasksFallbackEntry(name, record.id, Array.isArray(record.subtasks) ? record.subtasks : []).catch(() => {});
                 }
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
      const existingBeforeRemove = (name === 'procedures' && id) ? store.find('procedures', id) : null;
      const res = origRemove(name, id);
      if (name === 'availability') {
        if (sb && sb.isConfigured() && id) {
          const ts = enqueueAvailOp('delete', id, null);
          deleteAvailIdsRemote([String(id)]).then((result) => {
            if (result && result.ok) {
              dequeueAvailOps([{ id: String(id), ts }]);
            } else {
              console.warn('[syncSb] Availability delete queued for retry:', result && (result.message || result.error));
            }
          }).catch((e) => {
            console.warn('[syncSb] Availability delete queued for retry:', e && e.message);
          });
        }
        return res;
      }

      if (name === 'procedures') {
        if (sb && sb.isConfigured() && id) {
          const table = tables().procedures || 'procedures';
          const idsToDelete = [String(id)];
          if (existingBeforeRemove && Array.isArray(existingBeforeRemove.items)) {
            existingBeforeRemove.items.forEach((it) => {
              if (it && it.id) {
                idsToDelete.push(String(it.id));
                if (store.markDeleted) store.markDeleted('procedures', it.id);
              }
            });
          }
          const client = sb.getClient && sb.getClient();
          if (client) {
            client.from(table).delete().in('id', idsToDelete).then(() => {}, () => {});
          }
        }
        return res;
      }

      if (sb && sb.isConfigured() && COLLS.includes(name)) {
        const table = tables()[name];
        if ((name === 'tasks' || name === 'maintenance') && id && isColumnUnsupported(table, 'subtasks')) {
          persistSubtasksFallbackEntry(name, id, []).catch(() => {});
        }
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

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        drainAvailabilityQueue().catch(() => {});
      });
      window.addEventListener('focus', () => {
        if (Object.keys(readAvailQueue()).length) {
          drainAvailabilityQueue().catch(() => {});
        }
      });
    }
  }

  // Batch save for bulk availability updates (1 localStorage write + 1 chunked DB upsert)
  async function upsertAvailabilityBatch(records) {
    const normalized = (Array.isArray(records) ? records : []).map(normalizeAvailRecord).filter(Boolean);
    if (!normalized.length) return { ok: true, count: 0 };

    const existing = store.all('availability') || [];
    const byId = new Map(existing.filter((r) => r && r.id).map((r) => [r.id, r]));
    const queuedEntries = [];

    normalized.forEach((rec) => {
      if (store.unmarkDeleted) store.unmarkDeleted('availability', rec.id);
      byId.set(rec.id, rec);
      if (sb && sb.isConfigured()) {
        const ts = enqueueAvailOp('upsert', rec.id, rec);
        queuedEntries.push({ id: rec.id, ts });
      }
    });

    store.write('availability', dedupeAvailabilityByUserDate(Array.from(byId.values())));

    if (!sb || !sb.isConfigured()) {
      return { ok: true, count: normalized.length, backend: 'local' };
    }

    try {
      const res = await pushAvailRowsRemote(normalized);
      if (res && res.ok) {
        dequeueAvailOps(queuedEntries);
        return { ok: true, count: normalized.length, backend: availBackend };
      }
      return { ok: false, count: normalized.length, queued: true, message: res && res.message };
    } catch (e) {
      return { ok: false, count: normalized.length, queued: true, message: e && e.message };
    }
  }

  // Batch delete for bulk availability clearing (1 localStorage write + 1 chunked DB delete)
  async function deleteAvailabilityBatch(ids) {
    const cleanIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!cleanIds.length) return { ok: true, count: 0 };

    const idSet = new Set(cleanIds);
    const existing = store.all('availability') || [];
    const remaining = existing.filter((r) => r && r.id && !idSet.has(String(r.id)));
    const queuedEntries = [];

    cleanIds.forEach((id) => {
      if (store.markDeleted) store.markDeleted('availability', id);
      if (sb && sb.isConfigured()) {
        const ts = enqueueAvailOp('delete', id, null);
        queuedEntries.push({ id, ts });
      }
    });

    store.write('availability', remaining);

    if (!sb || !sb.isConfigured()) {
      return { ok: true, count: cleanIds.length, backend: 'local' };
    }

    try {
      const CHUNK = 50;
      for (let i = 0; i < cleanIds.length; i += CHUNK) {
        const res = await deleteAvailIdsRemote(cleanIds.slice(i, i + CHUNK));
        if (!res || !res.ok) {
          return { ok: false, count: cleanIds.length, queued: true, message: res && res.message };
        }
      }
      dequeueAvailOps(queuedEntries);
      return { ok: true, count: cleanIds.length, backend: availBackend };
    } catch (e) {
      return { ok: false, count: cleanIds.length, queued: true, message: e && e.message };
    }
  }

  async function verifySync() {
    if (!sb || !sb.isConfigured()) return { status: 'local', message: 'Running in offline/local storage mode.', queueLength: 0, tables: {} };
    
    const result = { status: 'checking', tables: {}, queueLength: 0, message: '' };
    try {
      await drainAvailabilityQueue();
      const advTable = tables().advancing || 'advancing';
      const repTable = tables().reports || 'reports';
      const bookTable = tables().bookings || 'bookings';
      const [advRows, repRows, bookRows, availRes] = await Promise.all([
        isTableUnsupported(advTable) ? Promise.resolve([]) : sb.selectAll(advTable).catch(()=>[]),
        isTableUnsupported(repTable) ? Promise.resolve([]) : sb.selectAll(repTable).catch(()=>[]),
        isTableUnsupported(bookTable) ? Promise.resolve([]) : sb.selectAll(bookTable).catch(()=>[]),
        fetchRemoteAvailability().catch((e) => ({ ok: false, backend: availBackend, rows: [], error: e && e.message }))
      ]);
      const pendingAvail = Object.keys(readAvailQueue()).length;
      result.queueLength = pendingAvail;
      result.tables.advancing = { count: advRows.length, ok: !isTableUnsupported(advTable) };
      result.tables.reports = { count: repRows.length, ok: !isTableUnsupported(repTable) };
      result.tables.bookings = { count: bookRows.length, ok: !isTableUnsupported(bookTable) };
      result.tables.availability = {
        count: (availRes && availRes.rows) ? availRes.rows.length : 0,
        ok: !!(availRes && availRes.ok),
        backend: (availRes && availRes.backend) || availBackend,
        pending: pendingAvail
      };
      result.status = (availRes && availRes.ok && pendingAvail === 0) ? 'synced' : 'degraded';
      const availNote = (availRes && availRes.ok)
        ? ('Availability in DB: ' + result.tables.availability.count + (result.tables.availability.backend === 'app_settings' ? ' (via app_settings)' : ''))
        : 'Availability sync pending';
      result.message = 'Supabase live & synced. Events in DB: ' + advRows.length + ', Shift reports: ' + repRows.length + ', ' + availNote + (pendingAvail ? (' (' + pendingAvail + ' queued)') : '');
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
    upsertAvailabilityBatch, deleteAvailabilityBatch,
    getAppSetting, setAppSetting,
    getAvailabilityBackend: () => availBackend,
    getPendingAvailabilityCount: () => Object.keys(readAvailQueue()).length,
    drain: drainAvailabilityQueue,
    deleteProcedureRow: (id) => RMTP.supabase.deleteRow("procedures", id)
  };
})();
