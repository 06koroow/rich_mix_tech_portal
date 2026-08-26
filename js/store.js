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
    try { adapter.set(key(name), JSON.stringify(value)); }
    catch (e) { console.warn('[store] write failed for', name, e); }
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
      write('maintenance', []);
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
  function remove(name, id) {
    write(name, read(name, []).filter((r) => r.id !== id));
  }

  let seq = 0;
  function uid(prefix) { seq += 1; return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + seq.toString(36); }

  return {
    init, reset, onChange, setAdapter, clearCache,
    read, write, readRaw, writeRaw, removeRaw, rawKeys,
    all, find, upsert, remove, uid,
  };
})();
