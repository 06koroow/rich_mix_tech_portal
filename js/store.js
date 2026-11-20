/* ============================================================
   store.js — persistence layer (adapter + cache)
   ------------------------------------------------------------
   The single I/O seam for the whole app. Views only ever call
   this; nothing else touches storage directly. It keeps an
   in-memory cache (fast, and the thing views read) backed by a
   pluggable ADAPTER that persists. The default adapter is
   localStorage — single-device, perfect for the prototype.

   GOING TO A BACKEND (see docs/BACKEND.md):
   Implement the small Adapter interface below against your API
   (SharePoint/Graph, Supabase, …) and call RMTP.store.setAdapter().
   The synchronous cache API (all/find/upsert/remove) stays the
   same, so no view changes. A remote adapter hydrates the cache
   on init() and pushes writes; on flaky venue Wi-Fi you keep the
   localStorage adapter as an offline cache and sync in the
   background. The public API here is the contract to preserve.
   ============================================================ */
RMTP.store = (function () {
  const PREFIX = RMTP.meta.storageKey + ':';
  const listeners = [];

  /* ---- Adapter: the only thing that changes for a real backend ----
     { get(key)->string|null, set(key,val), remove(key), keys()->[string] } */
  const LocalStorageAdapter = {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),   // throws QuotaExceededError — callers of raw writes catch it
    remove: (k) => localStorage.removeItem(k),
    keys: () => Object.keys(localStorage),
  };
  let adapter = LocalStorageAdapter;

  /* In-memory cache of parsed collections. Views read from here. */
  let cache = Object.create(null);

  function key(name) { return PREFIX + name; }
  function emit(name) { listeners.forEach((fn) => fn(name)); }
  function onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); }; }

  function setAdapter(a) { adapter = a; cache = Object.create(null); }
  function clearCache() { cache = Object.create(null); }

  function isQuotaError(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || ''));
  }

  function estimateStorageBytes() {
    try {
      let total = 0;
      const ks = adapter.keys();
      for (let i = 0; i < ks.length; i++) {
        const k = ks[i];
        const v = adapter.get(k);
        total += (k ? k.length : 0) + (v ? v.length : 0);
      }
      return total * 2; // UTF-16 bytes
    } catch (e) {
      return 0;
    }
  }

  // Collections that are safely persisted in Supabase and can be evicted from
  // localStorage (while staying in RAM `cache`) whenever browser quota gets tight.
  const EVICTABLE_COLLS = [
    'advancing', 'dcps', 'bookings', 'reports', 'inventory',
    'maintenance', 'procedures', 'patch_sheets', 'dmx_patches',
    'dmx_personalities', 'tasks', 'venues', 'signoffs', 'patch_presets'
  ];
  const CRITICAL_KEYS = new Set(['currentUser', 'role_views', 'prefs', 'users', 'hires_meta_cache']);

  function freeCacheSpace(opts) {
    const exclude = (opts && opts.exclude) ? new Set(opts.exclude) : new Set();
    let freed = 0;
    try {
      // 1. Remove base64 file blobs first (biggest space hogs — up to 3MB each)
      const ks = adapter.keys();
      ks.forEach((k) => {
        if (k.indexOf(PREFIX + 'file:') === 0 && !exclude.has(k.slice(PREFIX.length))) {
          const prev = adapter.get(k);
          freed += (prev ? prev.length * 2 : 0);
          adapter.remove(k);
        }
      });
      // 2. Evict large cloud-backed collection caches from localStorage (RAM cache stays intact)
      EVICTABLE_COLLS.forEach((coll) => {
        if (exclude.has(coll)) return;
        const fullKey = key(coll);
        const prev = adapter.get(fullKey);
        if (prev != null) {
          freed += prev.length * 2;
          adapter.remove(fullKey);
        }
      });
    } catch (e) { /* ignore */ }
    return freed;
  }

  function pruneLocalStorageForCloud() {
    // Always keep generous headroom (< 2.5MB used) so Supabase Auth session writes never hit 5MB quota
    if (estimateStorageBytes() > 2.5 * 1024 * 1024) {
      freeCacheSpace();
    }
  }

  /* ---- JSON collections (arrays / objects) ---- */
  function read(name, fallback) {
    if (name in cache) return cache[name];
    try {
      const raw = adapter.get(key(name));
      const val = raw != null ? JSON.parse(raw) : fallback;
      cache[name] = val;
      return val;
    } catch (e) {
      console.warn('[store] read failed for', name, e);
      return fallback;
    }
  }
  function write(name, value) {
    cache[name] = value;
    const isCloud = !!(window.RMTP && RMTP.supabase && RMTP.supabase.isConfigured && RMTP.supabase.isConfigured());
    try {
      const serialized = JSON.stringify(value);
      // In cloud mode, skip writing individual oversized collection caches (> 1MB) to localStorage
      // so they stay fast in memory without exhausting the 5MB browser quota needed by auth.
      if (isCloud && !CRITICAL_KEYS.has(name) && serialized.length * 2 > 1024 * 1024) {
        try { adapter.remove(key(name)); } catch (e2) {}
      } else {
        adapter.set(key(name), serialized);
      }
    } catch (e) {
      if (isQuotaError(e)) {
        if (isCloud || CRITICAL_KEYS.has(name)) {
          freeCacheSpace({ exclude: [name] });
          try {
            const serialized = JSON.stringify(value);
            if (!isCloud || CRITICAL_KEYS.has(name) || serialized.length * 2 <= 1024 * 1024) {
              adapter.set(key(name), serialized);
            }
          } catch (e2) {
            console.warn('[store] write kept in memory after quota eviction for', name);
          }
        } else {
          console.warn('[store] write failed for', name, e);
        }
      } else {
        console.warn('[store] write failed for', name, e);
      }
    }
    emit(name);
    return value;
  }

  /* ---- Raw string values (file blobs, session) ---- keeps files.js
     and auth.js off localStorage so there's one seam to swap. Raw
     writes are NOT cached and deliberately let quota errors throw. */
  function readRaw(rawKey, fallback) { const v = adapter.get(PREFIX + rawKey); return v == null ? (fallback === undefined ? null : fallback) : v; }
  function writeRaw(rawKey, str) { adapter.set(PREFIX + rawKey, str); return str; }
  function removeRaw(rawKey) { adapter.remove(PREFIX + rawKey); }
  function rawKeys(prefix) {
    const p = PREFIX + (prefix || '');
    return adapter.keys().filter((k) => k.indexOf(p) === 0).map((k) => k.slice(PREFIX.length));
  }

  /* ---- First-run seeding ---- */
  function init() {
    Object.keys(RMTP.seed).forEach((name) => {
      if (adapter.get(key(name)) === null) {
        let val = RMTP.seed[name];
        if (name === 'inventory' && Array.isArray(val) && window.RMTP && RMTP.qr && RMTP.qr.ensureItemTrackers) {
          val = val.map((it) => RMTP.qr.ensureItemTrackers(Object.assign({}, it)));
        }
        write(name, val);
      }
    });
    if (adapter.get(key('maintenance')) === null) {
      write('maintenance', [
        {
          id: 'fault-demo-1',
          taskType: 'consumables',
          equipment: 'Consumables Order: Haze Fluid, Black Gaffa Tape & 9V Batteries',
          category: 'Consumables',
          priority: 'High',
          status: 'Open',
          space: 'The Stage',
          reportedBy: 'Sam Okafor',
          assignedTechId: 'user-2',
          assignedTechName: 'Priya Shah',
          description: 'Hazer fluid critically low before the weekend live events. Also restocking 50mm black gaffa tape and wireless mic transmitter batteries.',
          consumableItems: [
            { name: 'Look Solutions Unique Haze Fluid (5L)', qty: '2 \u00d7 5L', notes: 'Stage left and right hazers' },
            { name: 'Advance AT200 Black Gaffa Tape (50mm)', qty: '6 rolls', notes: 'Main stage pit box restock' },
            { name: 'Procell Constant 9V Batteries (Box of 10)', qty: '1 box', notes: 'For wireless mic beltpacks' },
            { name: 'Procell AA Industrial Alkaline (Box of 24)', qty: '1 box', notes: 'In-ear monitor packs' }
          ],
          createdAt: Date.now() - 3600000 * 6
        },
        {
          id: 'fault-demo-2',
          taskType: 'fault',
          equipment: 'Soundcraft Vi1 \u2014 Channel 12 crackling on phantom power',
          category: 'Sound',
          priority: 'Medium',
          status: 'Open',
          space: 'The Stage',
          reportedBy: 'Danny Cole',
          assignedTechId: 'user-3',
          assignedTechName: 'Sam Okafor',
          itemId: 'inv-mix-001',
          itemTag: 'MIX-001',
          itemName: 'Soundcraft Vi1 Digital Console',
          description: 'Intermittent crackle when 48V phantom is active on channel 12. Preamp board needs inspection during next maintenance window.',
          createdAt: Date.now() - 3600000 * 24
        }
      ]);
    }
  }

  function reset() {
    Object.keys(RMTP.seed).forEach((name) => adapter.remove(key(name)));
    adapter.remove(key('maintenance'));
    adapter.remove(key('prefs'));
    adapter.remove(key('currentUser'));
    rawKeys('file:').forEach((k) => adapter.remove(PREFIX + k));
    clearCache();
    init();
  }

  /* ---- Generic collection helpers (arrays of {id, ...}) ----
     all() returns a shallow copy so callers can sort/slice freely
     without mutating the cached array. */
  function all(name)            { return read(name, []).slice(); }
  function find(name, id)       { return read(name, []).find((r) => r.id === id); }
  function get(name, id) {
    if (id !== undefined) return find(name, id);
    const val = read(name);
    return Array.isArray(val) ? val.slice() : val;
  }
  function upsert(name, record) {
    let rec = record;
    if (name === 'inventory' && rec && window.RMTP && RMTP.qr && RMTP.qr.ensureItemTrackers) {
      rec = RMTP.qr.ensureItemTrackers(Object.assign({}, rec));
    }
    const rows = read(name, []).slice();
    const i = rows.findIndex((r) => r.id === rec.id);
    if (i > -1) rows[i] = rec; else rows.push(rec);
    write(name, rows);
    return rec;
  }
  /* ---- Persistent Tombstones for Deleted Records ---- */
  function getDeleted(name) {
    try {
      const raw = localStorage.getItem('rmtp_deleted_' + name);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function markDeleted(name, id) {
    if (!id) return;
    try {
      const list = getDeleted(name);
      if (!list.includes(id)) {
        list.push(id);
        localStorage.setItem('rmtp_deleted_' + name, JSON.stringify(list));
      }
    } catch (e) {}
  }
  function unmarkDeleted(name, id) {
    if (!id) return;
    try {
      const list = getDeleted(name).filter((x) => x !== id);
      localStorage.setItem('rmtp_deleted_' + name, JSON.stringify(list));
    } catch (e) {}
  }
  function isDeleted(name, id) {
    if (!id) return false;
    return getDeleted(name).includes(id);
  }

  function remove(name, id) {
    markDeleted(name, id);
    write(name, read(name, []).filter((r) => r.id !== id));
  }

  let seq = 0;
  function uid(prefix) { seq += 1; return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + seq.toString(36); }

  return {
    init, reset, onChange, setAdapter, clearCache,
    read, write, readRaw, writeRaw, removeRaw, rawKeys,
    all, find, get, upsert, remove, uid,
    getDeleted, markDeleted, unmarkDeleted, isDeleted,
    freeCacheSpace, pruneLocalStorageForCloud, estimateStorageBytes,
  };
})();
