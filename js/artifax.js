/* ============================================================
   artifax.js — Artifax Sync Engine (v2), DB-Backed Suppression
   & Sync Diagnostics for Rich Mix Tech Portal
   ------------------------------------------------------------
   Single client-side coordinator for Artifax integration:
     • Strict status allowlist: ONLY "Contracted" or "Contract Sent"
       (hard-excluding Cancelled, Lost, Dead, Declined, Deleted, etc.)
     • Strict canonical venue space mapping (1 row = 1 booked space,
       skipping non-venue/admin/back-of-house/blank rooms)
     • DB-persisted deletion suppression (`public.app_settings` key
       `artifax_suppressed_events` + `portal_deleted_events`) with
       Unhide / Restore support in the Advancing Deleted tab
     • Authoritative reconciliation sweep: auto-removes cancelled,
       downgraded, non-venue, suppressed, or vanished Artifax events,
       cancels linked unworked Rota shifts (preserving past worked shifts),
       and marks linked DCP screenings as Cancelled
     • Dual-mode compatibility: works natively with the v2 Supabase Edge
       Function AND cleanly handles legacy raw-passthrough or v1 functions
       before redeployment
     • Built-in Sync Diagnostics & Dry-Run Preview modal for TM / Admins
   ============================================================ */
window.RMTP = window.RMTP || {};

RMTP.artifax = (function () {
  const SUPPRESSED_KEY = 'artifax_suppressed_events';
  const PORTAL_DELETED_KEY = 'portal_deleted_events';
  const LAST_SYNC_KEY = 'artifax_last_sync';
  const AUTO_SYNC_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

  // ---------- Canonical Rich Mix Venue Space Mapping ----------
  const EXACT_ROOM_TO_SPACE = {
    // The Stage
    'the stage (ms)': 'The Stage',
    'the stage': 'The Stage',
    'stage': 'The Stage',
    'main stage': 'The Stage',
    'ms': 'The Stage',
    'main space': 'The Stage',

    // The Studio
    'the studio (v1)': 'The Studio',
    'the studio': 'The Studio',
    'studio': 'The Studio',
    'studio 1': 'The Studio',
    'v1': 'The Studio',
    'venue 1': 'The Studio',

    // The Mix
    'the mix & bar (v2)': 'The Mix',
    'the mix and bar (v2)': 'The Mix',
    'the mix & bar': 'The Mix',
    'the mix and bar': 'The Mix',
    'the mix': 'The Mix',
    'mix': 'The Mix',
    'mix bar': 'The Mix',
    'the mix bar': 'The Mix',
    'v2': 'The Mix',
    'venue 2': 'The Mix',

    // Cinema Screens
    'screen 1': 'Screen One',
    'screen one': 'Screen One',
    'screen1': 'Screen One',
    'cinema 1': 'Screen One',
    'cinema one': 'Screen One',
    's1': 'Screen One',

    'screen 2': 'Screen Two',
    'screen two': 'Screen Two',
    'screen2': 'Screen Two',
    'cinema 2': 'Screen Two',
    'cinema two': 'Screen Two',
    's2': 'Screen Two',

    'screen 3': 'Screen Three',
    'screen three': 'Screen Three',
    'screen3': 'Screen Three',
    'cinema 3': 'Screen Three',
    'cinema three': 'Screen Three',
    's3': 'Screen Three',

    // Auxiliary Venue Spaces
    'streetside': 'Streetside',
    'street side': 'Streetside',
    'streetside bar': 'Streetside',
    'streetside cafe': 'Streetside',
    'streetside foyer': 'Streetside',
    'streetside / foyer': 'Streetside',
    'foyer': 'Streetside',

    'cinema bar / gallery': 'Cinema Bar',
    'cinema bar & gallery': 'Cinema Bar',
    'cinema bar and gallery': 'Cinema Bar',
    'cinema bar': 'Cinema Bar',
    'cinema gallery': 'Cinema Bar',

    'the lab': 'The Lab',
    'lab': 'The Lab',
  };

  const CANONICAL_SPACES = new Set([
    'The Stage',
    'The Studio',
    'The Mix',
    'Screen One',
    'Screen Two',
    'Screen Three',
    'Streetside',
    'Cinema Bar',
    'The Lab',
  ]);

  const AUXILIARY_SPACES = new Set(['Streetside', 'Cinema Bar', 'The Lab']);

  const NON_VENUE_ROOM_RE = /\b(office|desk|green\s*room|dressing\s*room|back\s*stage|backstage|stage\s*door|loading\s*bay|load[\s-]*in|store|storage|kitchen|staff\s*room|meeting\s*room|board\s*room|boardroom|box\s*office|reception|toilet|wc|corridor|stair|lift|elevator|plant\s*room|server\s*room|admin|hot\s*desk|workshop|car\s*park|parking|external|off[\s-]*site|offsite|tbc|tbd|unassigned|none)\b/i;

  const EXCLUDED_STATUS_RE = /\b(cancel(?:led|ed|ing)?|lost|dead|declin(?:ed)?|reject(?:ed)?|withdraw(?:n)?|releas(?:ed)?|delet(?:ed)?|archiv(?:ed)?|void(?:ed)?|abandoned|no[\s_-]*show|uncontracted|not\s+contracted|non[\s_-]*contracted)\b/i;

  function normalizeRoomKey(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/^rich\s*mix\s*[-:\/–—]?\s+/i, '')
      .trim();
  }

  function resolveVenueSpace(roomName) {
    if (roomName === null || roomName === undefined) return null;
    const raw = String(roomName).trim();
    if (!raw) return null;

    const key = normalizeRoomKey(raw);
    if (!key || key === 'rich mix') return null;

    if (EXACT_ROOM_TO_SPACE[key]) return EXACT_ROOM_TO_SPACE[key];
    if (NON_VENUE_ROOM_RE.test(key)) return null;

    if (/\b(screen\s*1|screen\s*one|cinema\s*1|cinema\s*one)\b/i.test(key)) return 'Screen One';
    if (/\b(screen\s*2|screen\s*two|cinema\s*2|cinema\s*two)\b/i.test(key)) return 'Screen Two';
    if (/\b(screen\s*3|screen\s*three|cinema\s*3|cinema\s*three)\b/i.test(key)) return 'Screen Three';
    if (/\bcinema\s*(bar|gallery)\b/i.test(key)) return 'Cinema Bar';
    if (/\bstreetside\b/i.test(key)) return 'Streetside';
    if (/\bthe\s+lab\b/i.test(key)) return 'The Lab';
    if (/\b(the\s+stage|main\s+stage)\b/i.test(key) || /\(ms\)/i.test(key)) return 'The Stage';
    if (/\bthe\s+studio\b/i.test(key) || /\(v1\)/i.test(key)) return 'The Studio';
    if (/\bthe\s+mix\b/i.test(key) || /\(v2\)/i.test(key)) return 'The Mix';

    return null;
  }

  function extractRawRooms(r) {
    const found = [];
    const pushVal = (v) => {
      if (v === null || v === undefined) return;
      if (typeof v === 'string' || typeof v === 'number') {
        const s = String(v).trim();
        if (s && !found.includes(s)) found.push(s);
      } else if (Array.isArray(v)) {
        v.forEach(pushVal);
      } else if (typeof v === 'object') {
        const name = v.room_name ?? v.room_description ?? v.name ?? v.roomName ?? v.RoomName ?? v.description ?? v.title;
        if (name) pushVal(name);
      }
    };

    const singleRoom = r.room_name ?? r.room_description ?? r.roomName ?? r.RoomName ?? r.room ?? r.Room ?? r.space ?? r.Space;
    if (singleRoom !== undefined && singleRoom !== null && String(singleRoom).trim() !== '') {
      pushVal(singleRoom);
    } else if (Array.isArray(r.rooms) && r.rooms.length > 0) {
      pushVal(r.rooms);
    } else if (Array.isArray(r.event_rooms) && r.event_rooms.length > 0) {
      pushVal(r.event_rooms);
    }
    return found;
  }

  function normalizeStageLabel(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/^[\[\(]?\d+[\]\)\.\-\s:]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function evaluateArtifaxStatus(r, opts) {
    const legacyPreMapped = !!(opts && opts.legacyPreMapped);
    const truthyFlag = (v) => v === true || v === 1 || v === '1' || String(v ?? '').trim().toLowerCase() === 'true';
    const falsyActiveFlag = (v) => v === false || v === 0 || v === '0' || String(v ?? '').trim().toLowerCase() === 'false';

    const flagDeleted = truthyFlag(r.deleted) || truthyFlag(r.is_deleted) || truthyFlag(r.isDeleted);
    const flagCancelled = truthyFlag(r.cancelled) || truthyFlag(r.canceled) || truthyFlag(r.is_cancelled) || truthyFlag(r.is_canceled) || truthyFlag(r.isCancelled);
    const flagArchived = truthyFlag(r.archived) || truthyFlag(r.is_archived) || truthyFlag(r.isArchived);
    const flagLost = truthyFlag(r.lost) || truthyFlag(r.is_lost) || truthyFlag(r.isLost);
    const flagInactive = (r.active !== undefined && r.active !== null && falsyActiveFlag(r.active)) ||
                         (r.is_active !== undefined && r.is_active !== null && falsyActiveFlag(r.is_active));

    const candidateKeys = [
      'sales_process_stage_name', 'sales_process_stage', 'salesProcessStage',
      'arrangement_status_name', 'arrangement_status', 'arrangementStatus',
      'event_status_name', 'event_status', 'eventStatus',
      'booking_status_name', 'booking_status', 'bookingStatus',
      'status_name', 'status', 'Status', 'stage_name', 'stage', 'state',
    ];

    const seenValues = [];
    for (const k of candidateKeys) {
      const v = r[k];
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' || typeof v === 'number') {
        const s = String(v).trim();
        if (s && !seenValues.includes(s)) seenValues.push(s);
      } else if (typeof v === 'object') {
        const nested = v.name ?? v.label ?? v.description ?? v.title ?? v.status;
        if (nested) {
          const s = String(nested).trim();
          if (s && !seenValues.includes(s)) seenValues.push(s);
        }
      }
    }

    const rawSummary = seenValues.length ? seenValues.join(' | ') : '(blank)';

    // Gate 1: Hard exclusion ALWAYS wins
    if (flagDeleted || flagCancelled || flagArchived || flagLost || flagInactive) {
      return { allowed: false, portalStatus: 'Cancelled', artifaxStage: rawSummary, rawStatusSummary: rawSummary, reason: 'excluded_flag' };
    }
    for (const val of seenValues) {
      if (EXCLUDED_STATUS_RE.test(val)) {
        return { allowed: false, portalStatus: 'Cancelled', artifaxStage: val, rawStatusSummary: rawSummary, reason: 'excluded_status' };
      }
    }

    // Gate 2: Strict allowlist — ONLY "Contracted" or "Contract Sent"
    let matchedStage = null;
    for (const val of seenValues) {
      const norm = normalizeStageLabel(val);
      if (/^contract\s*sent\b/.test(norm) || /\bcontract\s+sent\b/.test(norm)) {
        matchedStage = 'Contract Sent';
        break;
      }
      if (/^contracted\b/.test(norm) || /\bcontracted\b/.test(norm)) {
        matchedStage = 'Contracted';
        break;
      }
    }

    // If a legacy v1 Edge Function already pre-mapped raw statuses into { status: 'Confirmed' }
    // without preserving sales_process_stage_name, we cannot see the raw Artifax stage client-side
    // until the v2 Edge Function is deployed — accept Confirmed (still rejecting Cancelled) and flag deploy warning.
    if (!matchedStage && legacyPreMapped) {
      const stOnly = String(r.status || '').trim().toLowerCase();
      if (stOnly === 'confirmed') {
        return { allowed: true, portalStatus: 'Confirmed', artifaxStage: 'Confirmed (v1 Edge Function)', rawStatusSummary: rawSummary, reason: 'legacy_v1_confirmed' };
      }
    }

    if (!matchedStage) {
      return { allowed: false, portalStatus: 'Excluded', artifaxStage: rawSummary, rawStatusSummary: rawSummary, reason: 'not_contracted_stage' };
    }

    return {
      allowed: true,
      portalStatus: matchedStage === 'Contracted' ? 'Confirmed' : 'Advancing',
      artifaxStage: matchedStage,
      rawStatusSummary: rawSummary,
      reason: 'allowed',
    };
  }

  function parseSafeDate(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (!s) return '';
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  function parseSafeTime(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (!s) return '';
    const m = s.match(/(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 16);
  }

  function toCategory(type, title, space) {
    const combined = `${type || ''} ${title || ''} ${space || ''}`.toLowerCase();
    if (/cinema|film|screening|dcp|premiere|q&a|preview|docu|movie/.test(combined) ||
        /screen (one|two|three|1|2|3)|cinema (1|2|3|one|two|three)/.test(combined)) {
      return 'Cinema';
    }
    if (/hire|private|wedding|corporate|conference|launch/.test(combined)) return 'Private Hires';
    return 'Programme';
  }

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function extractArtifaxNotes(r) {
    const parts = [];
    const seenNotes = new Set();
    const addNote = (label, text) => {
      if (text === null || text === undefined) return;
      const str = String(text).trim();
      if (!str || seenNotes.has(str)) return;
      seenNotes.add(str);
      parts.push(label ? `[${label}]: ${str}` : str);
    };

    const candidateFields = [
      { key: 'notes', label: '' },
      { key: 'description', label: 'Description' },
      { key: 'event_notes', label: 'Event Notes' },
      { key: 'arrangement_notes', label: 'Arrangement Notes' },
      { key: 'internal_notes', label: 'Internal Notes' },
      { key: 'public_description', label: 'Public Description' },
      { key: 'event_description', label: 'Event Description' },
      { key: 'arrangement_description', label: 'Arrangement Description' },
      { key: 'comments', label: 'Comments' },
      { key: 'event_comments', label: 'Event Comments' },
      { key: 'arrangement_comments', label: 'Arrangement Comments' },
      { key: 'technical_requirements', label: 'Technical Requirements' },
      { key: 'tech_requirements', label: 'Tech Requirements' },
      { key: 'technical_notes', label: 'Technical Notes' },
      { key: 'tech_notes', label: 'Tech Notes' },
      { key: 'requirements', label: 'Requirements' },
      { key: 'setup_notes', label: 'Setup Notes' },
      { key: 'set_up_notes', label: 'Setup Notes' },
      { key: 'staging_notes', label: 'Staging Notes' },
      { key: 'av_notes', label: 'AV Notes' },
      { key: 'sound_notes', label: 'Sound Notes' },
      { key: 'lighting_notes', label: 'Lighting Notes' },
      { key: 'catering_notes', label: 'Catering Notes' },
      { key: 'special_instructions', label: 'Special Instructions' },
      { key: 'memo', label: 'Memo' },
      { key: 'memos', label: 'Memos' },
      { key: 'summary', label: 'Summary' },
      { key: 'details', label: 'Details' },
      { key: 'task_notes', label: 'Tasks' },
      { key: 'roster_notes', label: 'Roster Notes' },
      { key: 'Notes', label: '' },
      { key: 'Description', label: 'Description' },
      { key: 'EventNotes', label: 'Event Notes' },
      { key: 'ArrangementNotes', label: 'Arrangement Notes' },
      { key: 'InternalNotes', label: 'Internal Notes' },
      { key: 'TechnicalNotes', label: 'Technical Notes' },
      { key: 'Comments', label: 'Comments' },
    ];

    for (const { key, label } of candidateFields) {
      const val = r[key];
      if (val === undefined || val === null) continue;
      if (typeof val === 'string' || typeof val === 'number') {
        addNote(label, val);
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string') addNote(label, item);
          else if (item && typeof item === 'object') {
            const itemText = item.text ?? item.note ?? item.content ?? item.description ?? item.value ?? '';
            if (itemText) addNote(item.title ?? item.label ?? label, itemText);
          }
        }
      }
    }

    const forms = Array.isArray(r.custom_forms) ? r.custom_forms : (Array.isArray(r.forms) ? r.forms : []);
    for (const form of forms) {
      if (!form || typeof form !== 'object') continue;
      const formTitle = String(form.custom_form_name ?? form.form_name ?? form.name ?? form.title ?? form.label ?? '').trim();
      if (/credit\s*card|bank\s*account|stripe\s*token|password|secret/i.test(formTitle)) continue;

      const formElements = [];
      const sections = Array.isArray(form.custom_form_sections) ? form.custom_form_sections : (Array.isArray(form.sections) ? form.sections : []);
      for (const sec of sections) {
        if (!sec) continue;
        const elems = Array.isArray(sec.custom_form_elements) ? sec.custom_form_elements : (Array.isArray(sec.elements) ? sec.elements : (Array.isArray(sec.fields) ? sec.fields : []));
        formElements.push(...elems);
      }
      const directElems = Array.isArray(form.custom_form_elements) ? form.custom_form_elements : (Array.isArray(form.elements) ? form.elements : (Array.isArray(form.fields) ? form.fields : []));
      formElements.push(...directElems);

      for (const el of formElements) {
        if (!el || typeof el !== 'object') continue;
        const elName = String(el.custom_form_element_name ?? el.element_name ?? el.name ?? el.label ?? el.title ?? el.prompt ?? el.field_name ?? '').trim();
        if (!elName) continue;
        let val = el.custom_form_data_text !== undefined && el.custom_form_data_text !== null && el.custom_form_data_text !== ''
          ? el.custom_form_data_text
          : (el.custom_form_data_value !== undefined && el.custom_form_data_value !== null ? el.custom_form_data_value : (el.value ?? el.data_value ?? el.text_value ?? el.display_value ?? el.selected_option_label ?? ''));
        if (val === true) val = 'Yes';
        if (val === false) val = 'No';
        if (Array.isArray(val)) val = val.join(', ');
        const valStr = String(val ?? '').trim();
        if (!valStr) continue;
        addNote(formTitle ? `[${formTitle}] ${elName}` : elName, valStr);
      }
    }

    const customFields = Array.isArray(r.custom_fields) ? r.custom_fields : (Array.isArray(r.custom_form_elements) ? r.custom_form_elements : []);
    for (const cf of customFields) {
      if (!cf || typeof cf !== 'object') continue;
      const name = String(cf.name ?? cf.label ?? cf.title ?? cf.field_name ?? cf.custom_form_element_name ?? '').trim();
      let val = cf.value ?? cf.custom_form_data_text ?? cf.custom_form_data_value ?? cf.text ?? '';
      if (val === true) val = 'Yes';
      if (val === false) val = 'No';
      if (Array.isArray(val)) val = val.join(', ');
      const valStr = String(val ?? '').trim();
      if (name && valStr) addNote(name, valStr);
    }

    if (r.custom_form_data && typeof r.custom_form_data === 'object' && !Array.isArray(r.custom_form_data)) {
      for (const [k, v] of Object.entries(r.custom_form_data)) {
        if (v !== null && v !== undefined) {
          const vStr = String(v).trim();
          if (vStr) addNote(k, vStr);
        }
      }
    }

    return parts.join('\n').trim();
  }

  // ---------- DB-Persisted Suppression & Deleted Events Storage ----------
  function readLocalMap(key) {
    try {
      const val = RMTP.store && RMTP.store.read ? RMTP.store.read(key, null) : null;
      if (val && typeof val === 'object' && !Array.isArray(val)) return Object.assign({}, val);
    } catch (e) {}
    return {};
  }

  function writeLocalMap(key, mapObj) {
    try {
      if (RMTP.store && RMTP.store.write) {
        RMTP.store.write(key, mapObj || {});
      }
    } catch (e) {}
  }

  let suppressedCache = readLocalMap(SUPPRESSED_KEY);
  let portalDeletedCache = readLocalMap(PORTAL_DELETED_KEY);
  let lastSyncCache = null;
  try {
    lastSyncCache = RMTP.store && RMTP.store.read ? RMTP.store.read(LAST_SYNC_KEY, null) : null;
  } catch (e) {}

  function getArtifaxIdFromEvent(ev) {
    if (!ev) return '';
    if (ev.artifaxId) return String(ev.artifaxId).trim();
    const id = String(ev.id || '').trim();
    if (id.startsWith('evt-afx-')) return id.slice(8).trim();
    return '';
  }

  function isArtifaxEvent(ev) {
    return !!getArtifaxIdFromEvent(ev);
  }

  function getSuppressedMap() {
    return Object.assign({}, suppressedCache);
  }

  function getPortalDeletedMap() {
    return Object.assign({}, portalDeletedCache);
  }

  function getSuppressedIdSet() {
    const set = new Set();
    Object.entries(suppressedCache).forEach(([k, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      set.add(String(k));
      if (entry.artifaxId) {
        set.add(String(entry.artifaxId));
        set.add('evt-afx-' + String(entry.artifaxId));
      }
      if (entry.id) {
        const eid = String(entry.id);
        set.add(eid);
        if (eid.startsWith('evt-afx-')) set.add(eid.slice(8));
      }
    });
    return set;
  }

  function isSuppressed(evOrId) {
    const set = getSuppressedIdSet();
    if (!set.size) return false;
    if (typeof evOrId === 'string') {
      const s = evOrId.trim();
      if (!s) return false;
      const base = s.startsWith('evt-afx-') ? s.slice(8) : s;
      const root = base.includes('__') ? base.split('__')[0] : base;
      return set.has(s) || set.has(base) || set.has('evt-afx-' + base) || set.has(root);
    }
    if (evOrId && typeof evOrId === 'object') {
      const aid = getArtifaxIdFromEvent(evOrId);
      const eid = String(evOrId.id || '').trim();
      return (aid && isSuppressed(aid)) || (eid && isSuppressed(eid));
    }
    return false;
  }

  async function hydrateFromDb() {
    if (!RMTP.syncSb || typeof RMTP.syncSb.getAppSetting !== 'function') return;
    try {
      const [remoteSup, remotePortalDel, remoteLastSync] = await Promise.all([
        RMTP.syncSb.getAppSetting(SUPPRESSED_KEY),
        RMTP.syncSb.getAppSetting(PORTAL_DELETED_KEY),
        RMTP.syncSb.getAppSetting(LAST_SYNC_KEY),
      ]);

      if (remoteSup && typeof remoteSup === 'object' && !Array.isArray(remoteSup)) {
        suppressedCache = Object.assign({}, remoteSup);
        writeLocalMap(SUPPRESSED_KEY, suppressedCache);
      }
      if (remotePortalDel && typeof remotePortalDel === 'object' && !Array.isArray(remotePortalDel)) {
        portalDeletedCache = Object.assign({}, remotePortalDel);
        writeLocalMap(PORTAL_DELETED_KEY, portalDeletedCache);
      }
      if (remoteLastSync && typeof remoteLastSync === 'object') {
        lastSyncCache = remoteLastSync;
        try { if (RMTP.store && RMTP.store.write) RMTP.store.write(LAST_SYNC_KEY, lastSyncCache); } catch (e) {}
      }
    } catch (e) {
      console.warn('[artifax] hydrateFromDb warning:', e && e.message);
    }
  }

  async function persistSuppressedMap() {
    writeLocalMap(SUPPRESSED_KEY, suppressedCache);
    if (RMTP.syncSb && typeof RMTP.syncSb.setAppSetting === 'function') {
      return await RMTP.syncSb.setAppSetting(SUPPRESSED_KEY, suppressedCache);
    }
    return { ok: true, local: true };
  }

  async function persistPortalDeletedMap() {
    writeLocalMap(PORTAL_DELETED_KEY, portalDeletedCache);
    if (RMTP.syncSb && typeof RMTP.syncSb.setAppSetting === 'function') {
      return await RMTP.syncSb.setAppSetting(PORTAL_DELETED_KEY, portalDeletedCache);
    }
    return { ok: true, local: true };
  }

  function getActorName() {
    try {
      const me = RMTP.auth && RMTP.auth.current ? RMTP.auth.current() : null;
      if (!me) return 'Portal User';
      return (RMTP.auth.displayName && RMTP.auth.displayName(me)) || me.name || me.email || 'Portal User';
    } catch (e) {
      return 'Portal User';
    }
  }

  function cancelLinkedDcpsForEvent(eventId) {
    if (!eventId || !RMTP.store) return 0;
    const dcps = (RMTP.store.all('dcps') || []).filter((d) => d && d.eventId === eventId);
    const nowIso = new Date().toISOString();
    let count = 0;
    dcps.forEach((d) => {
      if (d.isCancelled === true && d.outcome === 'Cancelled') return;
      RMTP.store.upsert('dcps', Object.assign({}, d, {
        isCancelled: true,
        outcome: 'Cancelled',
        updatedAt: nowIso,
      }));
      count++;
    });
    return count;
  }

  function buildDeletedEntry(ev, source, reason, actor) {
    const aid = getArtifaxIdFromEvent(ev);
    const nowIso = new Date().toISOString();
    const key = source === 'artifax' ? aid : String(ev.id);
    // Keep a lean snapshot so restoring reproduces all fields without bloating app_settings
    const snapshot = Object.assign({}, ev, { deleted: false });
    return {
      key: key,
      id: String(ev.id || (aid ? 'evt-afx-' + aid : '')),
      artifaxId: aid || null,
      name: ev.name || 'Untitled Event',
      category: ev.category || '',
      space: typeof ev.space === 'string' ? ev.space : (Array.isArray(ev.space) ? ev.space[0] || '' : ''),
      date: parseSafeDate(ev.date) || ev.date || '',
      startTime: ev.startTime || '',
      finishTime: ev.finishTime || '',
      clientContact: ev.clientContact || '',
      status: ev.status || 'Confirmed',
      source: source,
      reason: reason || 'Deleted in portal',
      suppressedAt: nowIso,
      suppressedBy: actor || getActorName(),
      snapshot: snapshot,
    };
  }

  async function suppressEventsBulk(events, reason) {
    const list = (Array.isArray(events) ? events : [events]).filter(Boolean);
    if (!list.length) return { ok: true, count: 0, cancelledShifts: 0 };

    // Refresh remote suppression maps before merging so we never overwrite another admin's suppression
    await hydrateFromDb().catch(() => {});

    const actor = getActorName();
    let touchedSuppressed = false;
    let touchedPortalDel = false;
    let totalCancelledShifts = 0;
    const idsToDeleteRemote = [];

    for (const ev of list) {
      if (!ev || !ev.id) continue;
      const aid = getArtifaxIdFromEvent(ev);
      if (aid) {
        suppressedCache[aid] = buildDeletedEntry(ev, 'artifax', reason || 'Deleted in portal', actor);
        touchedSuppressed = true;
      } else {
        portalDeletedCache[String(ev.id)] = buildDeletedEntry(ev, 'manual', reason || 'Deleted in portal', actor);
        touchedPortalDel = true;
      }

      // Remove from active advancing store + Supabase
      if (RMTP.store) {
        if (RMTP.store.markDeleted) RMTP.store.markDeleted('advancing', ev.id);
        RMTP.store.remove('advancing', ev.id);
      }
      idsToDeleteRemote.push(String(ev.id));

      // Cancel linked unworked Rota shifts & DCPs
      if (RMTP.cancelUnworkedShiftsForEvent) {
        totalCancelledShifts += RMTP.cancelUnworkedShiftsForEvent(ev.id, 'Event deleted in portal');
      }
      cancelLinkedDcpsForEvent(ev.id);
    }

    const saves = [];
    if (touchedSuppressed) saves.push(persistSuppressedMap());
    if (touchedPortalDel) saves.push(persistPortalDeletedMap());
    await Promise.all(saves);

    // Ensure direct remote delete completed for every ID
    if (RMTP.supabase && RMTP.supabase.isConfigured() && idsToDeleteRemote.length) {
      try {
        const client = RMTP.supabase.getClient && RMTP.supabase.getClient();
        if (client) {
          await client.from('advancing').delete().in('id', idsToDeleteRemote);
        }
      } catch (e) {
        console.warn('[artifax] Bulk remote advancing delete warning:', e && e.message);
      }
    }

    return { ok: true, count: list.length, cancelledShifts: totalCancelledShifts };
  }

  async function suppressEvent(ev, reason) {
    return suppressEventsBulk(ev ? [ev] : [], reason);
  }

  async function unhideEvent(evOrKey) {
    await hydrateFromDb().catch(() => {});

    let key = '';
    let isAfx = false;
    let entry = null;

    if (typeof evOrKey === 'string') {
      key = evOrKey.trim();
      const stripped = key.startsWith('evt-afx-') ? key.slice(8) : key;
      if (suppressedCache[stripped]) {
        key = stripped;
        entry = suppressedCache[stripped];
        isAfx = true;
      } else if (suppressedCache[key]) {
        entry = suppressedCache[key];
        isAfx = true;
      } else if (portalDeletedCache[key]) {
        entry = portalDeletedCache[key];
        isAfx = false;
      }
    } else if (evOrKey && typeof evOrKey === 'object') {
      const aid = getArtifaxIdFromEvent(evOrKey);
      if (aid && suppressedCache[aid]) {
        key = aid;
        entry = suppressedCache[aid];
        isAfx = true;
      } else if (evOrKey._suppressedKey && suppressedCache[evOrKey._suppressedKey]) {
        key = evOrKey._suppressedKey;
        entry = suppressedCache[key];
        isAfx = true;
      } else if (evOrKey.id && portalDeletedCache[evOrKey.id]) {
        key = String(evOrKey.id);
        entry = portalDeletedCache[key];
        isAfx = false;
      }
    }

    if (isAfx && key) {
      delete suppressedCache[key];
      await persistSuppressedMap();
    } else if (!isAfx && key && portalDeletedCache[key]) {
      delete portalDeletedCache[key];
      await persistPortalDeletedMap();
    }

    // Restore snapshot into active advancing table immediately
    const restoredRecord = (entry && entry.snapshot)
      ? Object.assign({}, entry.snapshot, { deleted: false })
      : (evOrKey && typeof evOrKey === 'object' ? Object.assign({}, evOrKey, { deleted: false }) : null);

    if (restoredRecord && restoredRecord.id) {
      delete restoredRecord._deletedSource;
      delete restoredRecord._suppressedKey;
      delete restoredRecord._suppressedAt;
      delete restoredRecord._suppressedBy;
      delete restoredRecord._suppressedReason;

      if (RMTP.store) {
        if (RMTP.store.unmarkDeleted) RMTP.store.unmarkDeleted('advancing', restoredRecord.id);
        RMTP.store.upsert('advancing', restoredRecord);
      }
      if (RMTP.syncAdvancingToRota) {
        try { RMTP.syncAdvancingToRota(restoredRecord); } catch (e) {}
      }
      if (RMTP.syncAdvanceToDcp) {
        try { RMTP.syncAdvanceToDcp(restoredRecord); } catch (e) {}
      }
    }

    return { ok: true, isArtifax: isAfx, restored: restoredRecord };
  }

  function getAllDeletedEvents() {
    const out = [];
    const seenIds = new Set();

    // 1. DB-persisted Artifax suppressed events
    Object.entries(suppressedCache).forEach(([k, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const base = (entry.snapshot && typeof entry.snapshot === 'object') ? Object.assign({}, entry.snapshot) : {};
      const id = String(entry.id || base.id || ('evt-afx-' + k));
      if (seenIds.has(id)) return;
      seenIds.add(id);
      out.push(Object.assign(base, {
        id: id,
        artifaxId: entry.artifaxId || k,
        name: entry.name || base.name || 'Untitled Event',
        category: entry.category || base.category || '',
        space: entry.space || base.space || '',
        date: entry.date || base.date || '',
        startTime: entry.startTime || base.startTime || '',
        finishTime: entry.finishTime || base.finishTime || '',
        clientContact: entry.clientContact || base.clientContact || '',
        status: entry.status || base.status || 'Confirmed',
        deleted: true,
        _deletedSource: 'artifax',
        _suppressedKey: k,
        _suppressedAt: entry.suppressedAt || '',
        _suppressedBy: entry.suppressedBy || '',
        _suppressedReason: entry.reason || 'Suppressed from Artifax sync',
      }));
    });

    // 2. DB-persisted manually deleted portal events
    Object.entries(portalDeletedCache).forEach(([k, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const base = (entry.snapshot && typeof entry.snapshot === 'object') ? Object.assign({}, entry.snapshot) : {};
      const id = String(entry.id || base.id || k);
      if (seenIds.has(id)) return;
      seenIds.add(id);
      out.push(Object.assign(base, {
        id: id,
        name: entry.name || base.name || 'Untitled Event',
        category: entry.category || base.category || '',
        space: entry.space || base.space || '',
        date: entry.date || base.date || '',
        startTime: entry.startTime || base.startTime || '',
        finishTime: entry.finishTime || base.finishTime || '',
        clientContact: entry.clientContact || base.clientContact || '',
        status: entry.status || base.status || 'Confirmed',
        deleted: true,
        _deletedSource: 'manual',
        _suppressedKey: k,
        _suppressedAt: entry.suppressedAt || '',
        _suppressedBy: entry.suppressedBy || '',
        _suppressedReason: entry.reason || 'Deleted in portal',
      }));
    });

    // 3. Any legacy local `deleted: true` rows still in advancing cache
    const legacy = (RMTP.store && RMTP.store.all ? RMTP.store.all('advancing') : []).filter((e) => e && e.deleted === true);
    legacy.forEach((ev) => {
      if (seenIds.has(ev.id)) return;
      seenIds.add(ev.id);
      out.push(Object.assign({}, ev, {
        _deletedSource: isArtifaxEvent(ev) ? 'artifax' : 'manual',
        _suppressedKey: getArtifaxIdFromEvent(ev) || ev.id,
      }));
    });

    return out;
  }

  // ---------- Client-Side v2 Fallback Engine (for pre-redeploy Edge Functions) ----------
  function incrementMap(map, key) {
    const k = key || '(blank)';
    map[k] = (map[k] || 0) + 1;
  }

  async function runClientFallbackSync(rawList, opts) {
    const dryRun = !!(opts && opts.dryRun);
    const legacyPreMapped = !!(opts && opts.legacyPreMapped);
    const store = RMTP.store;
    const now = new Date();
    const nowIso = now.toISOString();
    const todayIso = nowIso.slice(0, 10);
    const startDate = new Date(now.getTime() - 1 * 864e5).toISOString().slice(0, 10);
    const endDate = new Date(now.getTime() + 180 * 864e5).toISOString().slice(0, 10);

    const validBookings = [];
    const seenValidArtifaxIds = new Set();
    const explicitlyExcludedRawIds = new Set();

    const diagIncludedStatuses = {};
    const diagSkippedStatuses = {};
    const diagMappedRooms = {};
    const diagSkippedRooms = {};

    let skippedStatusCount = 0;
    let skippedRoomCount = 0;
    let suppressedCount = 0;

    for (const r of rawList) {
      if (!r || typeof r !== 'object') continue;
      const rawId = String(r.artifaxId ?? r.event_id ?? r.id ?? r.instanceId ?? r.InstanceId ?? '').trim();
      if (!rawId || rawId === 'undefined' || rawId === 'null') continue;

      const statusEval = evaluateArtifaxStatus(r, { legacyPreMapped });
      if (!statusEval.allowed) {
        skippedStatusCount++;
        incrementMap(diagSkippedStatuses, statusEval.rawStatusSummary);
        explicitlyExcludedRawIds.add(rawId);
        continue;
      }

      const rawRooms = extractRawRooms(r);
      if (!rawRooms.length) {
        skippedRoomCount++;
        incrementMap(diagSkippedRooms, '(blank room)');
        explicitlyExcludedRawIds.add(rawId);
        continue;
      }

      const resolvedRooms = [];
      const seenSpaces = new Set();
      for (const rr of rawRooms) {
        const sp = resolveVenueSpace(rr);
        if (sp) {
          if (!seenSpaces.has(sp)) {
            seenSpaces.add(sp);
            resolvedRooms.push({ space: sp, rawRoom: rr });
          }
          if (!diagMappedRooms[rr]) diagMappedRooms[rr] = { space: sp, count: 0 };
          diagMappedRooms[rr].count++;
        } else {
          incrementMap(diagSkippedRooms, rr);
        }
      }

      if (!resolvedRooms.length) {
        skippedRoomCount++;
        explicitlyExcludedRawIds.add(rawId);
        continue;
      }

      const arrangementId = String(r.arrangement_id ?? r.arrangementId ?? r.ArrangementId ?? r.groupId ?? r.GroupId ?? '').trim();
      const title = String(r.arrangement_description ?? r.name ?? r.title ?? r.EventName ?? r.arrangement_name ?? r.event_description ?? 'Untitled').trim() || 'Untitled';
      const rawDate = r.event_date ?? r.start_date ?? r.date ?? r.StartDate ?? r.Date ?? r.start ?? r.startDateTime ?? r.StartDateTime ?? r.start_date_time;
      const rawStart = r.startTime ?? r.start_time ?? r.start_time_text ?? r.time_start ?? r.StartTime ?? r.start ?? r.startDateTime ?? r.StartDateTime ?? r.start_date_time;
      const rawEnd = r.finishTime ?? r.end_time ?? r.end_time_text ?? r.time_end ?? r.EndTime ?? r.end ?? r.endDateTime ?? r.EndDateTime ?? r.end_date_time;
      const dateIso = parseSafeDate(rawDate) || parseSafeDate(r.date) || '';
      const startTime = parseSafeTime(rawStart) || r.startTime || '';
      const finishTime = parseSafeTime(rawEnd) || r.finishTime || '';
      const contact = String(r.clientContact ?? r.contact ?? r.contactName ?? r.CustomerName ?? r.client_name ?? r.arrangement_contact_entity_full_name ?? '').trim();
      const rawType = String(r.category ?? r.arrangement_type_name ?? r.type ?? r.arrangementType ?? r.ArrangementType ?? '').trim();
      const notes = extractArtifaxNotes(r) || String(r.notes || r.description || '').trim();

      incrementMap(diagIncludedStatuses, `${statusEval.artifaxStage} (${statusEval.rawStatusSummary})`);

      for (const { space, rawRoom } of resolvedRooms) {
        const artifaxId = resolvedRooms.length === 1 ? rawId : `${rawId}__${slugify(space)}`;

        if (isSuppressed(artifaxId) || isSuppressed(rawId)) {
          suppressedCount++;
          explicitlyExcludedRawIds.add(artifaxId);
          continue;
        }
        if (seenValidArtifaxIds.has(artifaxId)) continue;
        seenValidArtifaxIds.add(artifaxId);

        validBookings.push({
          artifaxId,
          rawId,
          arrangementId,
          name: title,
          category: toCategory(rawType, title, space),
          space,
          rawRoom,
          date: dateIso,
          startTime,
          finishTime,
          clientContact: contact,
          status: statusEval.portalStatus === 'Advancing' ? 'Advancing' : 'Confirmed',
          artifaxStage: statusEval.artifaxStage,
          rawStatusSummary: statusEval.rawStatusSummary,
          notes,
        });
      }
    }

    const existingEvents = (store.all('advancing') || []).filter(Boolean);
    const existingByAid = new Map();
    existingEvents.forEach((ev) => {
      const aid = getArtifaxIdFromEvent(ev);
      if (aid) existingByAid.set(aid, ev);
    });

    let created = 0;
    let updated = 0;
    const newOrUpdatedRows = [];

    for (const booking of validBookings) {
      const existing = existingByAid.get(booking.artifaxId);
      const isAux = AUXILIARY_SPACES.has(booking.space);

      if (existing) {
        const changes = [];
        if (existing.date !== booking.date && booking.date) changes.push(`[Date Change]: Date moved to ${booking.date}`);
        if (existing.startTime !== booking.startTime && booking.startTime) changes.push(`[Time Change]: Start time updated to ${booking.startTime}`);
        if (existing.finishTime !== booking.finishTime && booking.finishTime) changes.push(`[Time Change]: Finish time updated to ${booking.finishTime}`);
        if (existing.space !== booking.space && booking.space) changes.push(`[Space Change]: Moved to ${booking.space}`);
        if (existing.name !== booking.name && booking.name) changes.push(`[Title Change]: Renamed to ${booking.name}`);
        if (existing.clientContact !== booking.clientContact && booking.clientContact) changes.push(`[Contact Change]: Contact updated to ${booking.clientContact}`);

        const existingPkg = (existing.production_package && typeof existing.production_package === 'object' && !Array.isArray(existing.production_package))
          ? Object.assign({}, existing.production_package)
          : {};
        const prevHistory = Array.isArray(existing.artifaxHistory)
          ? existing.artifaxHistory.slice()
          : (Array.isArray(existingPkg.artifaxHistory) ? existingPkg.artifaxHistory.slice() : []);
        const lastNotes = prevHistory.length ? (prevHistory[prevHistory.length - 1].notes || '') : '';
        if (booking.notes && booking.notes !== lastNotes) changes.push('[Artifax Notes Updated]');
        if (changes.length) {
          prevHistory.push({ date: nowIso, notes: booking.notes || lastNotes || '', changes });
        } else if (!prevHistory.length && booking.notes) {
          prevHistory.push({ date: nowIso, notes: booking.notes, changes: ['Initial sync from Artifax'] });
        }

        let resolvedPortalStatus = booking.status;
        if (existing.status === 'Complete') resolvedPortalStatus = 'Complete';
        else if (existing.status === 'Confirmed' && booking.status === 'Advancing') resolvedPortalStatus = 'Confirmed';

        existingPkg.artifaxHistory = prevHistory;
        existingPkg.artifaxNotes = booking.notes || existingPkg.artifaxNotes || '';
        existingPkg.artifaxStage = booking.artifaxStage;
        existingPkg.artifaxRoomRaw = booking.rawRoom;
        existingPkg.artifaxArrangementId = booking.arrangementId || null;
        existingPkg.artifaxSyncedAt = nowIso;

        const existingTech = String(existing.techInfo || '').trim();
        const row = Object.assign({}, existing, {
          artifaxId: booking.artifaxId,
          groupId: null,
          name: booking.name,
          category: booking.category,
          space: booking.space,
          date: booking.date,
          startTime: booking.startTime,
          finishTime: booking.finishTime,
          clientContact: booking.clientContact,
          status: resolvedPortalStatus,
          techInfo: existingTech ? existingTech : (booking.notes || ''),
          notes: booking.notes || existing.notes || '',
          artifaxNotes: booking.notes || existing.artifaxNotes || '',
          artifaxHistory: prevHistory,
          production_package: existingPkg,
        });
        delete row.deleted;
        if (existing.techRequiredManual === true) {
          row.noTechNeeded = false;
          row.techRequiredManual = true;
        } else if (existing.noTechNeeded !== undefined) {
          row.noTechNeeded = existing.noTechNeeded;
        } else if (isAux) {
          row.noTechNeeded = true;
        }
        newOrUpdatedRows.push(row);
        updated++;
      } else {
        const initHistory = booking.notes
          ? [{ date: nowIso, notes: booking.notes, changes: ['Initial sync from Artifax'] }]
          : [];
        const row = {
          id: 'evt-afx-' + booking.artifaxId,
          artifaxId: booking.artifaxId,
          groupId: null,
          name: booking.name,
          category: booking.category,
          space: booking.space,
          date: booking.date,
          startTime: booking.startTime,
          finishTime: booking.finishTime,
          clientContact: booking.clientContact,
          status: booking.status,
          notes: booking.notes || '',
          artifaxNotes: booking.notes || '',
          techInfo: booking.notes || '',
          artifaxHistory: initHistory,
          noTechNeeded: isAux,
          technicians: isAux
            ? [{ userId: '', role: 'None', isNoTech: true, isFreelancer: false, freelancerName: '', startTime: '', finishTime: '', bookingStatus: 'confirmed' }]
            : [],
          production_package: {
            artifaxHistory: initHistory,
            artifaxNotes: booking.notes || '',
            artifaxStage: booking.artifaxStage,
            artifaxRoomRaw: booking.rawRoom,
            artifaxArrangementId: booking.arrangementId || null,
            artifaxSyncedAt: nowIso,
            noTechNeeded: isAux,
          },
        };
        newOrUpdatedRows.push(row);
        created++;
      }
    }

    // Stale & cancelled reconciliation sweep
    const canSweepWindow = rawList.length > 0;
    const rowsToRemove = [];
    for (const ev of existingEvents) {
      const aid = getArtifaxIdFromEvent(ev);
      if (!aid) continue;
      const baseAid = aid.includes('__') ? aid.split('__')[0] : aid;
      if (seenValidArtifaxIds.has(aid)) continue;

      const rowDate = parseSafeDate(ev.date);
      const rowStatus = String(ev.status || '').trim().toLowerCase();
      const rowSpace = typeof ev.space === 'string' ? ev.space.trim() : '';
      const inSyncWindow = !!rowDate && rowDate >= startDate && rowDate <= endDate;

      let removeReason = null;
      if (isSuppressed(aid) || isSuppressed(baseAid) || isSuppressed(ev.id)) {
        removeReason = 'portal_suppressed';
      } else if (explicitlyExcludedRawIds.has(aid) || explicitlyExcludedRawIds.has(baseAid)) {
        removeReason = 'cancelled_or_non_contracted_in_artifax';
      } else if (rowStatus === 'cancelled' || rowStatus === 'canceled') {
        removeReason = 'legacy_cancelled_cleanup';
      } else if (rowSpace && !CANONICAL_SPACES.has(rowSpace)) {
        removeReason = 'non_venue_space_cleanup';
      } else if (canSweepWindow && inSyncWindow) {
        removeReason = 'removed_or_moved_in_artifax';
      }

      if (removeReason) {
        rowsToRemove.push({
          id: ev.id,
          artifaxId: aid,
          name: ev.name || 'Untitled',
          date: rowDate,
          space: rowSpace,
          reason: removeReason,
        });
      }
    }

    let cancelledShiftsCount = 0;
    let cancelledDcpsCount = 0;

    if (!dryRun) {
      if (store.remove) store.remove('advancing', 'evt-afx-undefined');

      for (const row of newOrUpdatedRows) {
        if (store.unmarkDeleted) store.unmarkDeleted('advancing', row.id);
        store.upsert('advancing', row);
        if (RMTP.syncAdvancingToRota) {
          try { RMTP.syncAdvancingToRota(row); } catch (e) {}
        }
        if (RMTP.syncAdvanceToDcp) {
          try { RMTP.syncAdvanceToDcp(row); } catch (e) {}
        }
      }

      const removeIds = [];
      for (const rem of rowsToRemove) {
        removeIds.push(rem.id);
        if (RMTP.cancelUnworkedShiftsForEvent) {
          cancelledShiftsCount += RMTP.cancelUnworkedShiftsForEvent(rem.id, 'Event cancelled or removed in Artifax');
        }
        cancelledDcpsCount += cancelLinkedDcpsForEvent(rem.id);
        store.remove('advancing', rem.id);
      }

      if (RMTP.supabase && RMTP.supabase.isConfigured() && removeIds.length) {
        try {
          const client = RMTP.supabase.getClient && RMTP.supabase.getClient();
          if (client) {
            for (let i = 0; i < removeIds.length; i += 100) {
              await client.from('advancing').delete().in('id', removeIds.slice(i, i + 100));
            }
          }
        } catch (e) {
          console.warn('[artifax] Client fallback delete warning:', e && e.message);
        }
      }

      if (RMTP.syncAdvancingToDcps) {
        try { RMTP.syncAdvancingToDcps(); } catch (e) {}
      }
    }

    const summary = {
      version: 2,
      syncedServerSide: false,
      needsEdgeFunctionDeploy: true,
      legacyEdgeFunctionType: legacyPreMapped ? 'v1_premapped' : 'raw_passthrough',
      dryRun,
      syncedAt: nowIso,
      window: { startDate, endDate },
      counts: {
        fetched: rawList.length,
        valid: validBookings.length,
        created,
        updated,
        removed: rowsToRemove.length,
        cancelledShifts: cancelledShiftsCount,
        cancelledDcps: cancelledDcpsCount,
        suppressed: suppressedCount,
        skippedStatus: skippedStatusCount,
        skippedRoom: skippedRoomCount,
      },
      diagnostics: {
        includedStatuses: diagIncludedStatuses,
        skippedStatuses: diagSkippedStatuses,
        mappedRooms: diagMappedRooms,
        skippedRooms: diagSkippedRooms,
        removedEvents: rowsToRemove.slice(0, 100),
        sampleSynced: dryRun
          ? validBookings.slice(0, 50).map((b) => ({
              artifaxId: b.artifaxId,
              name: b.name,
              space: b.space,
              rawRoom: b.rawRoom,
              date: b.date,
              startTime: b.startTime,
              finishTime: b.finishTime,
              artifaxStage: b.artifaxStage,
              portalStatus: b.status,
            }))
          : [],
      },
    };

    if (!dryRun) {
      lastSyncCache = summary;
      try { if (RMTP.store && RMTP.store.write) RMTP.store.write(LAST_SYNC_KEY, summary); } catch (e) {}
      if (RMTP.syncSb && typeof RMTP.syncSb.setAppSetting === 'function') {
        RMTP.syncSb.setAppSetting(LAST_SYNC_KEY, summary).catch(() => {});
      }
    }

    return summary;
  }

  // ---------- Main Sync Orchestrator ----------
  let syncInFlight = null;

  function detectEdgeResponseShape(data) {
    if (data && typeof data === 'object' && !Array.isArray(data) && Number(data.version) >= 2 && data.syncedServerSide === true) {
      return 'v2_server';
    }
    if (Array.isArray(data)) {
      return 'raw_passthrough';
    }
    if (data && typeof data === 'object') {
      const list = data.instances ?? data.events ?? data.results ?? data.data;
      if (Array.isArray(list)) {
        const looksPreMapped = data.created !== undefined && data.updated !== undefined &&
          (!list.length || (list[0] && list[0].artifaxId !== undefined && list[0].sales_process_stage_name === undefined));
        return looksPreMapped ? 'v1_premapped' : 'raw_passthrough';
      }
    }
    return 'unknown';
  }

  function ensureDraftShiftsForNewServerEvents() {
    if (!RMTP.store || !RMTP.syncAdvancingToRota) return;
    const allAdv = RMTP.store.all('advancing') || [];
    const allBookings = RMTP.store.all('bookings') || [];
    const bookedEventIds = new Set(allBookings.map((b) => b && b.eventId).filter(Boolean));
    const todayIso = new Date().toISOString().slice(0, 10);

    allAdv.forEach((ev) => {
      if (!ev || !ev.id || ev.deleted) return;
      const st = String(ev.status || '').trim().toLowerCase();
      if (st === 'cancelled' || st === 'canceled') return;
      const d = parseSafeDate(ev.date);
      if (d && d < todayIso) return;
      if (ev.artifaxId && !bookedEventIds.has(ev.id)) {
        try { RMTP.syncAdvancingToRota(ev); } catch (e) {}
      }
      if (ev.artifaxId && RMTP.syncAdvanceToDcp) {
        try { RMTP.syncAdvanceToDcp(ev); } catch (e) {}
      }
    });
  }

  async function sync(options) {
    const opts = typeof options === 'boolean' ? { silent: options } : (options || {});
    const silent = !!opts.silent;
    const dryRun = !!opts.dryRun;

    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
      const ui = RMTP.ui;
      const afxBtn = typeof document !== 'undefined' ? document.querySelector('#artifax-sync') : null;
      if (afxBtn && !dryRun) afxBtn.disabled = true;
      if (!silent && !dryRun && ui) ui.toast('Syncing from Artifax...', 'info');

      try {
        if (!RMTP.supabase || !RMTP.supabase.isConfigured()) {
          throw new Error('Supabase is not configured. Cannot invoke Artifax sync.');
        }

        // 1. Always hydrate latest DB-persisted suppression list first
        await hydrateFromDb().catch(() => {});

        // 2. Call Supabase Edge Function
        const res = await RMTP.supabase.invokeFunction('artifax-sync', dryRun ? { dryRun: true } : {});
        if (!res.ok) {
          throw new Error(res.message || 'Edge Function invocation failed');
        }
        const data = res.data;
        if (data && data.error) {
          throw new Error(data.error);
        }

        const shape = detectEdgeResponseShape(data);
        let summary;

        if (shape === 'v2_server') {
          summary = data;
          if (!dryRun) {
            // Pull reconciled collections directly from Supabase (pruning remotely deleted rows!)
            if (RMTP.syncSb && typeof RMTP.syncSb.pullCollection === 'function') {
              await Promise.allSettled([
                RMTP.syncSb.pullCollection('advancing'),
                RMTP.syncSb.pullCollection('bookings'),
                RMTP.syncSb.pullCollection('dcps'),
              ]);
            }
            ensureDraftShiftsForNewServerEvents();
            if (RMTP.syncAdvancingToDcps) {
              try { RMTP.syncAdvancingToDcps(); } catch (e) {}
            }
            lastSyncCache = summary;
            try { if (RMTP.store && RMTP.store.write) RMTP.store.write(LAST_SYNC_KEY, summary); } catch (e) {}
          }
        } else if (shape === 'raw_passthrough' || shape === 'v1_premapped') {
          const rawList = Array.isArray(data) ? data : (data.instances ?? data.events ?? data.results ?? data.data ?? []);
          summary = await runClientFallbackSync(rawList, {
            dryRun,
            legacyPreMapped: shape === 'v1_premapped',
          });
        } else {
          throw new Error('Unexpected response format from Artifax sync function.');
        }

        if (!dryRun) {
          const c = summary.counts || {};
          const parts = [];
          parts.push((c.created || 0) + ' added');
          parts.push((c.updated || 0) + ' updated');
          if (c.removed > 0) parts.push(c.removed + ' removed');
          if (c.cancelledShifts > 0) parts.push(c.cancelledShifts + ' shifts cancelled');
          const skippedTotal = (c.skippedStatus || 0) + (c.skippedRoom || 0) + (c.suppressed || 0);
          if (skippedTotal > 0) parts.push(skippedTotal + ' filtered out');

          if (!silent || (c.created || 0) > 0 || (c.updated || 0) > 0 || (c.removed || 0) > 0) {
            if (ui) ui.toast('Artifax sync: ' + parts.join(', '), 'ok');
          }
          if (!silent && summary.legacyEdgeFunctionType === 'v1_premapped' && ui) {
            ui.toast('Tip: Redeploy the updated artifax-sync Edge Function so Contracted / Contract Sent filtering runs server-side.', 'info');
          }
          if (RMTP.router && typeof RMTP.router.render === 'function') {
            RMTP._isSoftRender = true;
            RMTP.router.render();
            RMTP._isSoftRender = false;
          }
        }

        return { ok: true, summary };
      } catch (err) {
        const msg = (err && err.message) || String(err);
        if (!silent && !dryRun && ui) {
          ui.toast('Artifax sync failed: ' + msg, 'danger');
        }
        return { ok: false, error: msg };
      } finally {
        if (afxBtn && !dryRun) afxBtn.disabled = false;
        syncInFlight = null;
      }
    })();

    return syncInFlight;
  }

  async function autoSyncOnBoot() {
    if (!RMTP.supabase || !RMTP.supabase.isConfigured()) return;
    const auth = RMTP.auth;
    const me = auth && auth.current ? auth.current() : null;
    if (!me) return;

    // Restrict boot auto-sync to Technical Managers, Senior Techs, and Admins
    const allowed = (RMTP.isTMOrST && RMTP.isTMOrST(me)) || (auth.isAdmin && auth.isAdmin(me));
    if (!allowed) return;

    await hydrateFromDb().catch(() => {});

    // Respect shared 15-minute cooldown across sessions
    if (lastSyncCache && lastSyncCache.syncedAt) {
      const elapsed = Date.now() - new Date(lastSyncCache.syncedAt).getTime();
      if (!isNaN(elapsed) && elapsed >= 0 && elapsed < AUTO_SYNC_COOLDOWN_MS) {
        return;
      }
    }

    return sync({ silent: true });
  }

  // ---------- Sync Diagnostics & Dry-Run Inspection Modal ----------
  function renderKeyValueRows(mapObj, emptyText, isRoomMap) {
    const entries = Object.entries(mapObj || {}).sort((a, b) => {
      const ca = isRoomMap ? (a[1].count || 0) : (Number(a[1]) || 0);
      const cb = isRoomMap ? (b[1].count || 0) : (Number(b[1]) || 0);
      return cb - ca;
    });
    if (!entries.length) {
      return '<div class="text-xs text-muted italic py-2">' + RMTP.ui.esc(emptyText) + '</div>';
    }
    return (
      '<div class="divide-y divide-line/50 max-h-44 overflow-y-auto">' +
        entries.map(([k, v]) => {
          const count = isRoomMap ? (v.count || 0) : v;
          const mappedTo = isRoomMap && v.space ? (' <span class="text-muted">\u2192</span> <span class="text-accent font-semibold">' + RMTP.ui.esc(v.space) + '</span>') : '';
          return (
            '<div class="py-1.5 flex items-center justify-between gap-2 text-xs">' +
              '<span class="truncate text-ink">' + RMTP.ui.esc(k) + mappedTo + '</span>' +
              '<span class="font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded bg-panel2 border border-line text-muted shrink-0">' + RMTP.ui.esc(String(count)) + '</span>' +
            '</div>'
          );
        }).join('') +
      '</div>'
    );
  }

  async function openDiagnosticsModal() {
    const ui = RMTP.ui;
    if (!ui) return;
    await hydrateFromDb().catch(() => {});

    let currentSummary = lastSyncCache;
    let isPreview = false;

    const m = ui.modal({
      title: 'Artifax Sync Diagnostics',
      body: '<div id="afx-diag-root" class="space-y-4"></div>',
      size: 'lg',
      footer:
        '<button type="button" id="afx-diag-dryrun" class="btn btn-ghost text-xs">' + ui.icon('eye', 'w-3.5 h-3.5') + '<span>Run Dry-Run Preview</span></button>' +
        '<button type="button" id="afx-diag-sync" class="btn btn-primary text-xs">' + ui.icon('reset', 'w-3.5 h-3.5') + '<span>Sync Now</span></button>' +
        '<button type="button" data-close-diag class="btn btn-ghost text-xs">Close</button>',
    });

    const renderBody = () => {
      const root = m.root.querySelector('#afx-diag-root');
      if (!root) return;

      const supCount = Object.keys(suppressedCache).length;
      if (!currentSummary) {
        root.innerHTML =
          '<div class="p-4 rounded-xl bg-panel2 border border-line text-sm text-muted">' +
            '<p>No Artifax sync has been recorded yet. Run a <strong>Dry-Run Preview</strong> to inspect live Artifax statuses and rooms without changing any database records, or click <strong>Sync Now</strong>.</p>' +
            '<p class="mt-2 text-xs">Currently suppressed (portal-deleted) Artifax events: <strong class="text-ink">' + supCount + '</strong></p>' +
          '</div>';
        return;
      }

      const c = currentSummary.counts || {};
      const d = currentSummary.diagnostics || {};
      const modeBadge = currentSummary.syncedServerSide
        ? '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-ok/15 text-ok border border-ok/30">Server Engine v' + ui.esc(String(currentSummary.version || 2)) + '</span>'
        : '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-warning/15 text-warning border border-warning/30">Client Fallback (Redeploy Edge Function)</span>';

      const deployNotice = !currentSummary.syncedServerSide
        ? (
          '<div class="p-3 rounded-lg bg-warning/10 border border-warning/30 text-xs text-ink leading-relaxed">' +
            '<strong class="text-warning">Edge Function Update Recommended:</strong> Your deployed Supabase <code class="font-mono">artifax-sync</code> function is still running the older ' +
            (currentSummary.legacyEdgeFunctionType === 'v1_premapped' ? 'v1 pre-mapped' : 'passthrough') +
            ' version. The portal is enforcing strict filtering, suppression, and cleanup automatically in the browser, but redeploying <code class="font-mono">supabase/functions/artifax-sync/index.ts</code> ensures scheduled cron syncs also use v2.' +
          '</div>'
        ) : '';

      const removedRows = Array.isArray(d.removedEvents) ? d.removedEvents : [];
      const removedHtml = removedRows.length
        ? (
          '<div class="border border-line rounded-xl p-3 bg-panel">' +
            '<div class="text-xs font-semibold uppercase tracking-wider text-muted mb-2">' +
              (isPreview ? 'Events That Would Be Auto-Removed (' : 'Auto-Removed Events (') + removedRows.length + ')' +
            '</div>' +
            '<div class="divide-y divide-line/50 max-h-40 overflow-y-auto">' +
              removedRows.map((r) => (
                '<div class="py-1.5 flex items-center justify-between gap-2 text-xs">' +
                  '<div class="min-w-0 truncate"><span class="font-medium text-ink">' + ui.esc(r.name || 'Untitled') + '</span>' +
                  (r.space ? ' <span class="text-muted">\u00b7 ' + ui.esc(r.space) + '</span>' : '') +
                  (r.date ? ' <span class="font-mono text-[11px] text-muted">\u00b7 ' + ui.esc(r.date) + '</span>' : '') + '</div>' +
                  '<span class="text-[11px] text-danger shrink-0">' + ui.esc(String(r.reason || '').replace(/_/g, ' ')) + '</span>' +
                '</div>'
              )).join('') +
            '</div>' +
          '</div>'
        ) : '';

      root.innerHTML =
        '<div class="flex flex-wrap items-center justify-between gap-2">' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            modeBadge +
            (isPreview ? '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-accent/15 text-accent border border-accent/30">Dry-Run Preview (No DB Changes)</span>' : '') +
            '<span class="text-xs text-muted">Rules: <strong>Contracted</strong> &amp; <strong>Contract Sent</strong> only \u00b7 1 row per booked venue space</span>' +
          '</div>' +
          (currentSummary.syncedAt ? '<span class="text-[11px] font-mono text-muted">' + ui.esc(new Date(currentSummary.syncedAt).toLocaleString()) + '</span>' : '') +
        '</div>' +
        deployNotice +
        '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' +
          '<div class="p-2.5 rounded-lg bg-panel2 border border-line"><div class="text-[11px] text-muted">Fetched</div><div class="text-lg font-display font-bold tabular-nums">' + (c.fetched || 0) + '</div></div>' +
          '<div class="p-2.5 rounded-lg bg-panel2 border border-line"><div class="text-[11px] text-muted">' + (isPreview ? 'Would Sync' : 'Added / Updated') + '</div><div class="text-lg font-display font-bold tabular-nums text-ok">' + (isPreview ? (c.valid || 0) : ((c.created || 0) + ' / ' + (c.updated || 0))) + '</div></div>' +
          '<div class="p-2.5 rounded-lg bg-panel2 border border-line"><div class="text-[11px] text-muted">' + (isPreview ? 'Would Remove' : 'Auto-Removed') + '</div><div class="text-lg font-display font-bold tabular-nums text-danger">' + (c.removed || 0) + '</div></div>' +
          '<div class="p-2.5 rounded-lg bg-panel2 border border-line"><div class="text-[11px] text-muted">Suppressed (DB)</div><div class="text-lg font-display font-bold tabular-nums text-muted">' + supCount + '</div></div>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
          '<div class="border border-line rounded-xl p-3 bg-panel">' +
            '<div class="text-xs font-semibold uppercase tracking-wider text-ok mb-1.5">Included Artifax Stages</div>' +
            renderKeyValueRows(d.includedStatuses, 'No matching Contracted / Contract Sent events found.', false) +
          '</div>' +
          '<div class="border border-line rounded-xl p-3 bg-panel">' +
            '<div class="text-xs font-semibold uppercase tracking-wider text-danger mb-1.5">Excluded Artifax Stages (' + (c.skippedStatus || 0) + ')</div>' +
            renderKeyValueRows(d.skippedStatuses, 'None excluded by status.', false) +
          '</div>' +
          '<div class="border border-line rounded-xl p-3 bg-panel">' +
            '<div class="text-xs font-semibold uppercase tracking-wider text-accent mb-1.5">Mapped Venue Rooms</div>' +
            renderKeyValueRows(d.mappedRooms, 'No venue rooms mapped.', true) +
          '</div>' +
          '<div class="border border-line rounded-xl p-3 bg-panel">' +
            '<div class="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">Skipped Non-Venue Rooms (' + (c.skippedRoom || 0) + ')</div>' +
            renderKeyValueRows(d.skippedRooms, 'No non-venue rooms skipped.', false) +
          '</div>' +
        '</div>' +
        removedHtml;
    };

    renderBody();

    const closeBtn = m.root.querySelector('[data-close-diag]');
    if (closeBtn) closeBtn.addEventListener('click', m.close);

    const dryBtn = m.root.querySelector('#afx-diag-dryrun');
    if (dryBtn) {
      dryBtn.addEventListener('click', async () => {
        dryBtn.disabled = true;
        dryBtn.querySelector('span').textContent = 'Running preview...';
        const res = await sync({ silent: true, dryRun: true });
        dryBtn.disabled = false;
        dryBtn.querySelector('span').textContent = 'Run Dry-Run Preview';
        if (res && res.ok && res.summary) {
          currentSummary = res.summary;
          isPreview = true;
          renderBody();
        } else {
          ui.toast('Dry-run failed: ' + ((res && res.error) || 'Unknown error'), 'danger');
        }
      });
    }

    const syncBtn = m.root.querySelector('#afx-diag-sync');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        syncBtn.querySelector('span').textContent = 'Syncing...';
        const res = await sync({ silent: false, dryRun: false });
        syncBtn.disabled = false;
        syncBtn.querySelector('span').textContent = 'Sync Now';
        if (res && res.ok && res.summary) {
          currentSummary = res.summary;
          isPreview = false;
          renderBody();
        }
      });
    }
  }

  // Register top-level alias for compatibility with existing callers
  RMTP.syncArtifax = function (silent) {
    return sync({ silent: !!silent, dryRun: false });
  };

  return {
    CANONICAL_SPACES,
    AUXILIARY_SPACES,
    EXACT_ROOM_TO_SPACE,
    resolveVenueSpace,
    extractRawRooms,
    evaluateArtifaxStatus,
    extractArtifaxNotes,
    parseSafeDate,
    parseSafeTime,
    toCategory,
    getArtifaxIdFromEvent,
    isArtifaxEvent,
    hydrateFromDb,
    getSuppressedMap,
    getPortalDeletedMap,
    getSuppressedIdSet,
    isSuppressed,
    suppressEvent,
    suppressEventsBulk,
    unhideEvent,
    getAllDeletedEvents,
    getLastSync: () => lastSyncCache,
    sync,
    autoSyncOnBoot,
    openDiagnosticsModal,
  };
})();
