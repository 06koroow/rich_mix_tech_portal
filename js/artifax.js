/* ============================================================
   artifax.js — Artifax Two-Way Sync Engine (v3), DB-Backed
   Suppression, Write-Back, PDF Sync & Diagnostics
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
     • Non-destructive Write-Back to a dedicated Artifax Custom Form
       ("Tech Portal Advancing") with 3-layer zero-recursion protection
     • Two-way PDF Document Sync (GET Artifax PDFs + POST Portal Tech
       Specs & Advance Sheet PDFs) with SHA-256 deduplication
     • Built-in Sync Diagnostics, Dry-Run Preview & Schema Discovery modal
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

  // ---------- Layer 1 Zero-Recursion Guards ----------
  const PORTAL_SENTINEL_RE = /\[RMTP_PORTAL_SYNC_START\][\s\S]*?\[RMTP_PORTAL_SYNC_END\]/gi;

  function stripPortalSentinelBlocks(text) {
    return String(text || '').replace(PORTAL_SENTINEL_RE, '').trim();
  }

  function isPortalOwnedCustomForm(form) {
    if (!form || typeof form !== 'object') return false;
    const title = String(
      form.custom_form_name ?? form.form_name ?? form.name ?? form.title ?? form.label ?? ''
    ).trim();
    if (/^tech\s*portal\b/i.test(title) || /\btech\s*portal\s*advancing\b/i.test(title) || /\brmtp\b/i.test(title)) {
      return true;
    }
    return false;
  }

  function extractArtifaxNotes(r) {
    const parts = [];
    const seenNotes = new Set();
    const addNote = (label, text) => {
      if (text === null || text === undefined) return;
      const str = stripPortalSentinelBlocks(String(text));
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
      // Layer-1 Loop Prevention: NEVER pull our own portal write-back Custom Form back into Artifax notes
      if (isPortalOwnedCustomForm(form)) continue;
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

  function withTimeout(promise, ms, fallbackVal) {
    return new Promise((resolve) => {
      let settled = false;
      const t = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(fallbackVal);
        }
      }, ms);
      Promise.resolve(promise).then(
        (v) => {
          if (!settled) {
            settled = true;
            clearTimeout(t);
            resolve(v);
          }
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(t);
            resolve(fallbackVal);
          }
        }
      );
    });
  }

  async function hydrateFromDb() {
    if (!RMTP.syncSb || typeof RMTP.syncSb.getAppSetting !== 'function') return;
    try {
      const [remoteSup, remotePortalDel, remoteLastSync] = await withTimeout(
        Promise.all([
          RMTP.syncSb.getAppSetting(SUPPRESSED_KEY),
          RMTP.syncSb.getAppSetting(PORTAL_DELETED_KEY),
          RMTP.syncSb.getAppSetting(LAST_SYNC_KEY),
        ]),
        4000,
        [null, null, null]
      );

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
  let syncInFlightSilent = true;

  function setSyncButtonBusy(busy) {
    if (typeof document === 'undefined') return;
    const afxBtn = document.querySelector('#artifax-sync');
    if (!afxBtn) return;
    afxBtn.disabled = !!busy;
    const span = afxBtn.querySelector('span');
    if (span) span.textContent = busy ? 'Syncing...' : 'Sync Artifax';
  }

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

  async function runSyncRequest(opts) {
    const dryRun = !!opts.dryRun;
    const ui = RMTP.ui;
    const isSilent = () => (dryRun ? !!opts.silent : syncInFlightSilent);

    if (!dryRun) setSyncButtonBusy(true);
    if (!isSilent() && !dryRun && ui) ui.toast('Syncing from Artifax...', 'info');

    try {
      if (!RMTP.supabase || !RMTP.supabase.isConfigured()) {
        throw new Error('Supabase is not configured. Cannot invoke Artifax sync.');
      }

      // 1. Hydrate latest DB-persisted suppression list (bounded by 4s timeout)
      await hydrateFromDb().catch(() => {});

      // 2. Call Supabase Edge Function (bounded by 45s timeout so a network hang never wedges the button)
      const res = await withTimeout(
        RMTP.supabase.invokeFunction('artifax-sync', dryRun ? { dryRun: true } : {}),
        45000,
        { ok: false, message: 'Artifax sync timed out after 45 seconds. Check Edge Function logs in Supabase.' }
      );
      if (!res || !res.ok) {
        throw new Error((res && res.message) || 'Edge Function invocation failed');
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
            await withTimeout(
              Promise.allSettled([
                RMTP.syncSb.pullCollection('advancing'),
                RMTP.syncSb.pullCollection('bookings'),
                RMTP.syncSb.pullCollection('dcps'),
              ]),
              15000,
              null
            );
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

        if (!isSilent() || (c.created || 0) > 0 || (c.updated || 0) > 0 || (c.removed || 0) > 0) {
          if (ui) ui.toast('Artifax sync: ' + parts.join(', '), 'ok');
        }
        if (!isSilent() && summary.legacyEdgeFunctionType === 'v1_premapped' && ui) {
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
      console.error('[artifax] sync error:', err);
      if (!isSilent() && !dryRun && ui) {
        ui.toast('Artifax sync failed: ' + msg, 'danger');
      }
      return { ok: false, error: msg };
    } finally {
      if (!dryRun) {
        setSyncButtonBusy(false);
        syncInFlight = null;
        syncInFlightSilent = true;
      }
    }
  }

  async function sync(options) {
    const opts = typeof options === 'boolean' ? { silent: options } : (options || {});
    const silent = !!opts.silent;
    const dryRun = !!opts.dryRun;

    // Never let a background live sync block a Dry-Run Preview
    if (dryRun) {
      return runSyncRequest({ silent, dryRun: true });
    }

    if (syncInFlight) {
      // If a user manually clicked Sync while silent boot sync was running, upgrade to visible feedback
      if (!silent) {
        syncInFlightSilent = false;
        setSyncButtonBusy(true);
        if (RMTP.ui) RMTP.ui.toast('Artifax sync is already running — updating shortly...', 'info');
      }
      return syncInFlight;
    }

    syncInFlightSilent = silent;
    syncInFlight = runSyncRequest({ silent, dryRun: false });
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

  // ---------- Part B: Two-Way Write-Back (Portal -> Artifax Custom Form) ----------
  function resolveUserName(userId) {
    if (!userId || !RMTP.store) return '';
    const u = RMTP.store.find ? RMTP.store.find('users', userId) : null;
    if (!u) return '';
    return (RMTP.auth && RMTP.auth.displayName ? RMTP.auth.displayName(u) : (u.name || u.email || '')).trim();
  }

  function buildPortalWritePayload(ev) {
    if (!ev || typeof ev !== 'object') {
      return { techNotes: '', timings: '', crew: '', specSummary: '', updatedBy: getActorName(), hasPortalContent: false };
    }

    const pkg = (ev.production_package && typeof ev.production_package === 'object' && !Array.isArray(ev.production_package))
      ? ev.production_package
      : {};

    // 1. Portal Tech Notes (avoid echoing untouched Artifax-imported notes back into Artifax)
    const rawTechInfo = stripPortalSentinelBlocks(String(ev.techInfo || '').trim());
    const rawArtifaxNotes = stripPortalSentinelBlocks(String(ev.artifaxNotes || pkg.artifaxNotes || ev.notes || '').trim());
    const techNotesLines = [];
    if (rawTechInfo && rawTechInfo !== rawArtifaxNotes) {
      techNotesLines.push(rawTechInfo);
    }
    if (ev.lighting_notes || ev.lightingNotes) {
      techNotesLines.push('Lighting: ' + String(ev.lighting_notes || ev.lightingNotes).trim());
    }
    if (ev.sound_notes || ev.soundNotes) {
      techNotesLines.push('Sound: ' + String(ev.sound_notes || ev.soundNotes).trim());
    }
    if (ev.staging_notes || ev.stagingNotes) {
      techNotesLines.push('Staging/Floor: ' + String(ev.staging_notes || ev.stagingNotes).trim());
    }
    const techNotes = techNotesLines.join('\n').trim();

    // 2. Technical Schedule & Timings
    const timingLines = [];
    const addT = (label, val) => {
      const s = String(val || '').trim();
      if (s) timingLines.push(`${label}: ${s}`);
    };
    addT('Load-in', ev.load_in || ev.loadIn);
    addT('Soundcheck / Tech Rehearsal', ev.soundcheck || ev.soundCheck);
    addT('Doors', ev.doors);
    if (ev.startTime || ev.finishTime) {
      timingLines.push(`Event Window: ${[ev.startTime, ev.finishTime].filter(Boolean).join(' - ')}`);
    }
    addT('Off-Stage', ev.off_stage || ev.offStage);
    addT('Curfew', ev.curfew);
    addT('Load-out', ev.load_out || ev.loadOut);

    const scheduleItems = Array.isArray(ev.schedule_items)
      ? ev.schedule_items
      : (Array.isArray(ev.scheduleItems) ? ev.scheduleItems : []);
    if (scheduleItems.length) {
      timingLines.push('Running Order:');
      scheduleItems.forEach((it) => {
        if (!it || typeof it !== 'object') return;
        const t = it.time || [it.startTime, it.finishTime].filter(Boolean).join('-') || '';
        const lbl = [it.label || it.type, it.customName].filter(Boolean).join(' — ');
        const line = [t ? `@ ${t}` : '', lbl || 'Activity', it.notes ? `(${String(it.notes).trim()})` : ''].filter(Boolean).join(' ');
        if (line) timingLines.push(`  • ${line}`);
      });
    }

    // Cinema screening details if applicable
    const mediaType = ev.media_type || ev.mediaType || '';
    if (mediaType || ev.dcp_received || ev.dcpReceived || ev.checks_completed || ev.checksCompleted || ev.qa || ev.intermission) {
      const cinBits = [];
      if (mediaType) cinBits.push('Media: ' + mediaType);
      if (ev.dcp_received || ev.dcpReceived) cinBits.push('DCP Received');
      if (ev.checks_completed || ev.checksCompleted) cinBits.push('Checks Complete');
      if (ev.intermission) cinBits.push('Intermission');
      if (ev.qa) cinBits.push('Q&A');
      if (cinBits.length) timingLines.push('Cinema: ' + cinBits.join(' | '));
    }
    const timings = timingLines.join('\n').trim();

    // 3. Assigned Technical Crew
    const crewLines = [];
    const leadId = (RMTP.getAdvancingLeadId ? RMTP.getAdvancingLeadId(ev) : '') || ev.responsible_for_advancing || ev.advancingLeadId || pkg.advancingLeadId || '';
    const leadName = resolveUserName(leadId);
    if (leadName) crewLines.push('Advancing Lead: ' + leadName);

    const techs = RMTP.eventTechnicians ? RMTP.eventTechnicians(ev) : (Array.isArray(ev.technicians) ? ev.technicians : []);
    if (ev.noTechNeeded || (techs.length === 1 && techs[0] && techs[0].isNoTech)) {
      crewLines.push('Crew Requirement: No Technical Staff Required');
    } else if (techs.length) {
      techs.forEach((t) => {
        if (!t || typeof t !== 'object') return;
        if (t.isNoTech) return;
        const name = t.isFreelancer
          ? (String(t.freelancerName || '').trim() || 'Freelancer (TBC)')
          : (resolveUserName(t.userId) || 'Unassigned Shift');
        const role = t.role ? ` (${t.role})` : '';
        const shiftTimes = [t.startTime, t.finishTime].filter(Boolean).join('-');
        const statusStr = t.bookingStatus && t.bookingStatus !== 'confirmed' ? ` [${t.bookingStatus}]` : '';
        crewLines.push(`• ${name}${role}${shiftTimes ? ' ' + shiftTimes : ''}${statusStr}`);
      });
    }
    const crew = crewLines.join('\n').trim();

    // 4. Spec & Package Summary
    const specLines = [];
    specLines.push(`Portal Status: ${ev.status || 'Confirmed'} | Space: ${ev.space || 'TBC'} | Category: ${ev.category || 'Programme'}`);
    if (ev.techSpec && ev.techSpec.name) {
      specLines.push(`Tech Spec Attached: ${ev.techSpec.name}`);
    }
    if (ev.floorPlan || ev.floor_plan || pkg.floorPlan || pkg.seatingLayout) {
      specLines.push(`Layout / Floor Plan: ${ev.floorPlan || ev.floor_plan || pkg.floorPlan || pkg.seatingLayout}`);
    }
    if (pkg.lightingRig || pkg.paSetup || pkg.avSetup) {
      const rig = [pkg.paSetup ? 'PA: ' + pkg.paSetup : '', pkg.lightingRig ? 'LX: ' + pkg.lightingRig : '', pkg.avSetup ? 'AV: ' + pkg.avSetup : ''].filter(Boolean);
      if (rig.length) specLines.push('Production Spec: ' + rig.join(' | '));
    }
    if (Array.isArray(ev.equipmentBookings) && ev.equipmentBookings.length) {
      const eqSummary = ev.equipmentBookings
        .map((b) => (b.qty && b.qty > 1 ? `${b.qty}x ` : '') + (b.itemName || b.name || 'Equipment'))
        .slice(0, 12)
        .join(', ');
      if (eqSummary) specLines.push('Allocated Equipment: ' + eqSummary);
    }
    const checklist = Array.isArray(ev.checklist) ? ev.checklist : (Array.isArray(pkg.checklist) ? pkg.checklist : []);
    if (checklist.length) {
      const done = checklist.filter((c) => c && (c.done || c.checked)).length;
      specLines.push(`Advancing Checklist: ${done}/${checklist.length} completed`);
    }
    const specSummary = specLines.join('\n').trim();

    const hasPortalContent = Boolean(techNotes || timings || crew || (ev.techSpec && ev.techSpec.name));
    return {
      techNotes,
      timings,
      crew,
      specSummary,
      updatedBy: getActorName(),
      hasPortalContent,
    };
  }

  function updateLocalEventPackageMeta(eventId, patch) {
    if (!eventId || !RMTP.store || !RMTP.store.find) return null;
    const latest = RMTP.store.find('advancing', eventId);
    if (!latest) return null;
    const pkg = (latest.production_package && typeof latest.production_package === 'object' && !Array.isArray(latest.production_package))
      ? Object.assign({}, latest.production_package)
      : {};
    Object.assign(pkg, patch);
    const updated = Object.assign({}, latest, { production_package: pkg });
    RMTP.store.upsert('advancing', updated);
    return updated;
  }

  async function pushEvent(ev, options) {
    const opts = options || {};
    const silent = !!opts.silent;
    const force = !!opts.force;
    const ui = RMTP.ui;

    const artifaxId = getArtifaxIdFromEvent(ev);
    if (!artifaxId) {
      return { ok: false, skipped: true, reason: 'not_artifax_event' };
    }
    if (!RMTP.supabase || !RMTP.supabase.isConfigured()) {
      return { ok: false, error: 'Supabase is not configured' };
    }

    const pkg = (ev.production_package && typeof ev.production_package === 'object') ? ev.production_package : {};
    const arrangementId = String(pkg.artifaxArrangementId || ev.arrangementId || '').trim();
    const payload = buildPortalWritePayload(ev);

    if (!force && !payload.hasPortalContent && !pkg.artifaxLastPushedAt) {
      return { ok: true, skipped: true, reason: 'no_portal_changes' };
    }

    try {
      const res = await RMTP.supabase.invokeFunction('artifax-sync', {
        action: 'push_event',
        eventId: ev.id,
        artifaxId,
        arrangementId,
        force,
        payload: {
          techNotes: payload.techNotes,
          timings: payload.timings,
          crew: payload.crew,
          specSummary: payload.specSummary,
          updatedBy: payload.updatedBy,
        },
      });

      if (!res.ok) {
        const msg = res.message || 'Write-back request failed';
        updateLocalEventPackageMeta(ev.id, {
          artifaxLastPushStatus: 'error',
          artifaxLastPushError: msg,
        });
        if (!silent && ui) ui.toast('Artifax push failed: ' + msg, 'danger');
        return { ok: false, error: msg };
      }

      const data = res.data;
      // Detect old v1/v2 Edge Function that ignored `action: "push_event"`
      if (!data || Array.isArray(data) || (data.syncedServerSide === true && data.action !== 'push_event')) {
        const msg = 'Redeploy the v3 artifax-sync Edge Function to enable Artifax write-back.';
        if (!silent && ui) ui.toast(msg, 'info');
        return { ok: false, needsRedeploy: true, error: msg };
      }

      if (data.notConfigured) {
        updateLocalEventPackageMeta(ev.id, {
          artifaxLastPushStatus: 'not_configured',
          artifaxLastPushError: data.error || 'Custom Form secrets not configured yet',
        });
        if (!silent && ui) {
          ui.toast('Artifax write-back needs setup: open Sync Log → Discover Artifax Schema.', 'info');
        }
        return { ok: false, notConfigured: true, missingSecrets: data.missingSecrets || [], error: data.error };
      }

      if (data.error && !data.ok) {
        updateLocalEventPackageMeta(ev.id, {
          artifaxLastPushStatus: 'error',
          artifaxLastPushError: data.error,
        });
        if (!silent && ui) ui.toast('Artifax push failed: ' + data.error, 'danger');
        return { ok: false, error: data.error };
      }

      if (data.skipped) {
        if (!silent && ui) ui.toast('Artifax is already up to date (no new portal changes).', 'info');
        return { ok: true, skipped: true, hash: data.hash, pushedAt: data.pushedAt };
      }

      updateLocalEventPackageMeta(ev.id, {
        artifaxLastPushHash: data.hash || null,
        artifaxLastPushedAt: data.pushedAt || new Date().toISOString(),
        artifaxLastPushStatus: 'ok',
        artifaxLastPushError: null,
        artifaxLastPushEndpoint: data.endpoint || null,
      });

      if (!silent && ui) ui.toast('Pushed portal advancing info to Artifax', 'ok');
      return { ok: true, pushedAt: data.pushedAt, hash: data.hash, endpoint: data.endpoint };
    } catch (err) {
      const msg = (err && err.message) || String(err);
      updateLocalEventPackageMeta(ev.id, {
        artifaxLastPushStatus: 'error',
        artifaxLastPushError: msg,
      });
      if (!silent && ui) ui.toast('Artifax push failed: ' + msg, 'danger');
      return { ok: false, error: msg };
    }
  }

  // ---------- Part B: Two-Way PDF Document Sync ----------
  function isPdfFileMeta(meta) {
    if (!meta) return false;
    const name = String(meta.name || '').toLowerCase();
    const type = String(meta.type || '').toLowerCase();
    return name.endsWith('.pdf') || type === 'application/pdf';
  }

  async function listDocuments(ev) {
    const artifaxId = getArtifaxIdFromEvent(ev);
    if (!artifaxId) return { ok: false, documents: [], reason: 'not_artifax_event' };
    if (!RMTP.supabase || !RMTP.supabase.isConfigured()) {
      return { ok: false, documents: [], error: 'Supabase not configured' };
    }
    const pkg = (ev.production_package && typeof ev.production_package === 'object') ? ev.production_package : {};
    const arrangementId = String(pkg.artifaxArrangementId || ev.arrangementId || '').trim();

    try {
      const res = await RMTP.supabase.invokeFunction('artifax-sync', {
        action: 'list_documents',
        eventId: ev.id,
        artifaxId,
        arrangementId,
      });
      if (!res.ok) return { ok: false, documents: [], error: res.message || 'Could not load Artifax documents' };
      const data = res.data;
      if (!data || Array.isArray(data) || data.action !== 'list_documents') {
        return { ok: false, documents: Array.isArray(pkg.artifaxDocuments) ? pkg.artifaxDocuments : [], needsRedeploy: true, error: 'Redeploy v3 artifax-sync Edge Function to load Artifax PDFs.' };
      }
      if (data.error && !data.ok) {
        return { ok: false, documents: Array.isArray(pkg.artifaxDocuments) ? pkg.artifaxDocuments : [], error: data.error };
      }
      const docs = Array.isArray(data.documents) ? data.documents : [];
      updateLocalEventPackageMeta(ev.id, {
        artifaxDocuments: docs,
        artifaxDocsCheckedAt: new Date().toISOString(),
      });
      return { ok: true, documents: docs, probes: data.probes || [] };
    } catch (err) {
      return { ok: false, documents: Array.isArray(pkg.artifaxDocuments) ? pkg.artifaxDocuments : [], error: (err && err.message) || String(err) };
    }
  }

  function base64ToBlob(b64, contentType) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: contentType || 'application/pdf' });
  }

  async function downloadDocument(ev, doc) {
    const artifaxId = getArtifaxIdFromEvent(ev);
    if (!RMTP.supabase || !RMTP.supabase.isConfigured()) {
      return { ok: false, error: 'Supabase not configured' };
    }
    const pkg = (ev && ev.production_package && typeof ev.production_package === 'object') ? ev.production_package : {};
    const arrangementId = String(pkg.artifaxArrangementId || (ev && ev.arrangementId) || '').trim();

    try {
      const res = await RMTP.supabase.invokeFunction('artifax-sync', {
        action: 'download_document',
        documentId: doc.artifaxDocId || doc.id || '',
        downloadPath: doc.downloadPath || '',
        filename: doc.name || 'artifax-document.pdf',
        artifaxId,
        arrangementId,
      });
      if (!res.ok) return { ok: false, error: res.message || 'Download failed' };
      const data = res.data;
      if (!data || !data.ok || !data.base64) {
        return { ok: false, error: (data && data.error) || 'Could not retrieve PDF from Artifax' };
      }
      const blob = base64ToBlob(data.base64, data.contentType || 'application/pdf');
      return {
        ok: true,
        blob,
        filename: data.filename || doc.name || 'artifax-document.pdf',
        size: data.size || blob.size,
      };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }

  async function openArtifaxDocument(ev, doc) {
    const ui = RMTP.ui;
    if (ui) ui.toast('Fetching PDF from Artifax...', 'info');
    const res = await downloadDocument(ev, doc);
    if (!res.ok) {
      if (ui) ui.toast('Could not open Artifax PDF: ' + (res.error || 'Unknown error'), 'danger');
      return res;
    }

    const blobUrl = URL.createObjectURL(res.blob);
    if (!ui || typeof ui.modal !== 'function') {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      return res;
    }

    // In-app PDF preview modal (safe inside iframes — avoids window.open)
    const pm = ui.modal({
      title: res.filename || 'Artifax PDF Document',
      size: 'md:max-w-4xl',
      body:
        '<div class="flex flex-col gap-3">' +
          '<div class="flex items-center justify-between text-xs text-muted">' +
            '<span>Source: <strong class="text-ink">' + ui.esc(doc.origin === 'portal' ? 'Uploaded from Tech Portal' : 'Artifax Document') + '</strong>' +
            (res.size && RMTP.files && RMTP.files.humanSize ? ' \u00b7 ' + ui.esc(RMTP.files.humanSize(res.size)) : '') + '</span>' +
            '<a id="afx-pdf-dl" href="' + blobUrl + '" download="' + ui.esc(res.filename) + '" class="btn btn-primary !py-1.5 text-xs inline-flex items-center gap-1.5">' +
              ui.icon('download', 'w-3.5 h-3.5') + '<span>Download PDF</span>' +
            '</a>' +
          '</div>' +
          '<iframe src="' + blobUrl + '" title="' + ui.esc(res.filename) + '" class="w-full h-[65vh] rounded-lg border border-line bg-white"></iframe>' +
        '</div>',
      footer: '<button type="button" data-close-pdf class="btn btn-ghost text-xs">Close</button>',
    });

    const closeBtn = pm.root.querySelector('[data-close-pdf]');
    const cleanup = () => {
      try { URL.revokeObjectURL(blobUrl); } catch (e) {}
    };
    const origClose = pm.close;
    pm.close = function () {
      cleanup();
      origClose();
    };
    if (closeBtn) closeBtn.addEventListener('click', () => pm.close());
    return res;
  }

  async function uploadDocument(ev, opts) {
    const o = opts || {};
    const silent = !!o.silent;
    const ui = RMTP.ui;
    const artifaxId = getArtifaxIdFromEvent(ev);
    if (!artifaxId) return { ok: false, skipped: true, reason: 'not_artifax_event' };
    if (!RMTP.supabase || !RMTP.supabase.isConfigured()) {
      return { ok: false, error: 'Supabase not configured' };
    }

    const pkg = (ev.production_package && typeof ev.production_package === 'object') ? ev.production_package : {};
    const arrangementId = String(pkg.artifaxArrangementId || ev.arrangementId || '').trim();

    try {
      const res = await RMTP.supabase.invokeFunction('artifax-sync', {
        action: 'upload_document',
        eventId: ev.id,
        artifaxId,
        arrangementId,
        filename: o.filename || 'portal-document.pdf',
        base64: o.base64 || undefined,
        sourceUrl: o.sourceUrl || undefined,
        kind: o.kind || 'tech_spec',
        force: !!o.force,
      });

      if (!res.ok) {
        const msg = res.message || 'PDF upload failed';
        if (!silent && ui) ui.toast('Artifax PDF upload failed: ' + msg, 'danger');
        return { ok: false, error: msg };
      }

      const data = res.data;
      if (!data || Array.isArray(data) || data.action !== 'upload_document') {
        const msg = 'Redeploy the v3 artifax-sync Edge Function to upload PDFs to Artifax.';
        if (!silent && ui) ui.toast(msg, 'info');
        return { ok: false, needsRedeploy: true, error: msg };
      }
      if (data.error && !data.ok) {
        if (!silent && ui) ui.toast('Artifax PDF upload failed: ' + data.error, 'danger');
        return { ok: false, error: data.error };
      }
      if (data.skipped) {
        if (!silent && ui) ui.toast('This PDF is already uploaded to Artifax.', 'info');
        return { ok: true, skipped: true, sha256: data.sha256, document: data.document };
      }

      if (data.document) {
        const currentDocs = Array.isArray(pkg.artifaxDocuments) ? pkg.artifaxDocuments.slice() : [];
        const existsIdx = currentDocs.findIndex((d) =>
          (data.document.artifaxDocId && d.artifaxDocId === data.document.artifaxDocId) ||
          (data.document.sha256 && d.sha256 === data.document.sha256)
        );
        if (existsIdx >= 0) currentDocs[existsIdx] = data.document;
        else currentDocs.push(data.document);
        updateLocalEventPackageMeta(ev.id, { artifaxDocuments: currentDocs });
      }

      if (!silent && ui) ui.toast('Uploaded PDF to Artifax: ' + (o.filename || 'document.pdf'), 'ok');
      return { ok: true, document: data.document, sha256: data.sha256, endpoint: data.endpoint };
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (!silent && ui) ui.toast('Artifax PDF upload failed: ' + msg, 'danger');
      return { ok: false, error: msg };
    }
  }

  async function uploadEventTechSpecPdf(ev, options) {
    const opts = options || {};
    if (!ev || !ev.techSpec || !isArtifaxEvent(ev)) {
      return { ok: false, skipped: true, reason: 'no_tech_spec' };
    }
    if (!isPdfFileMeta(ev.techSpec)) {
      if (!opts.silent && RMTP.ui) RMTP.ui.toast('Only PDF tech specs can be uploaded to Artifax.', 'info');
      return { ok: false, skipped: true, reason: 'not_pdf' };
    }

    const filename = ev.techSpec.name || ((ev.name || 'event') + ' - Tech Spec.pdf');
    let sourceUrl = '';
    let base64 = '';

    if (ev.techSpec.url && /^https:\/\//i.test(ev.techSpec.url)) {
      sourceUrl = ev.techSpec.url;
    } else if (RMTP.files && typeof RMTP.files.dataUrl === 'function') {
      const raw = RMTP.files.dataUrl(ev.techSpec);
      if (raw && typeof raw === 'string' && raw.startsWith('data:')) {
        base64 = raw.includes(',') ? raw.split(',')[1] : raw;
      }
    }

    if (!sourceUrl && !base64) {
      return { ok: false, skipped: true, reason: 'spec_bytes_unavailable' };
    }

    return uploadDocument(ev, {
      filename,
      sourceUrl: sourceUrl || undefined,
      base64: base64 || undefined,
      kind: 'tech_spec',
      force: !!opts.force,
      silent: !!opts.silent,
    });
  }

  async function uploadGeneratedAdvancePdf(ev, htmlContent, options) {
    const opts = options || {};
    const ui = RMTP.ui;
    if (!ev || !isArtifaxEvent(ev)) return { ok: false, skipped: true, reason: 'not_artifax_event' };
    if (typeof window === 'undefined' || typeof window.html2pdf !== 'function') {
      if (!opts.silent && ui) ui.toast('PDF generator library is not loaded.', 'danger');
      return { ok: false, error: 'html2pdf unavailable' };
    }

    const fileDate = parseSafeDate(ev.date) || 'TBC';
    const safeTitle = String(ev.name || 'Event').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
    const safeSpace = String(ev.space || 'Venue').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const filename = `${fileDate} - ${safeTitle} - Tech Advance (${safeSpace}).pdf`;

    if (!opts.silent && ui) ui.toast('Generating Advance Sheet PDF for Artifax...', 'info');

    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-10000px';
    holder.style.top = '0';
    holder.style.width = '794px';
    holder.style.background = '#ffffff';
    holder.style.color = '#111111';
    holder.innerHTML = htmlContent;
    document.body.appendChild(holder);

    try {
      const dataUri = await window.html2pdf()
        .set({
          margin: [8, 8, 8, 8],
          filename,
          image: { type: 'jpeg', quality: 0.92 },
          html2canvas: { scale: 1.5, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(holder)
        .outputPdf('datauristring');

      const base64 = String(dataUri || '').includes(',') ? String(dataUri).split(',')[1] : '';
      if (!base64) {
        throw new Error('Could not generate PDF bytes');
      }

      return await uploadDocument(ev, {
        filename,
        base64,
        kind: 'advance_sheet',
        force: true,
        silent: !!opts.silent,
      });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (!opts.silent && ui) ui.toast('Could not generate Advance PDF: ' + msg, 'danger');
      return { ok: false, error: msg };
    } finally {
      try { document.body.removeChild(holder); } catch (e) {}
    }
  }

  async function discoverSchema() {
    if (!RMTP.supabase || !RMTP.supabase.isConfigured()) {
      return { ok: false, error: 'Supabase is not configured' };
    }
    try {
      const res = await RMTP.supabase.invokeFunction('artifax-sync', { action: 'discover_schema' });
      if (!res.ok) return { ok: false, error: res.message || 'Schema probe failed' };
      const data = res.data;
      if (!data || Array.isArray(data) || data.action !== 'discover_schema') {
        return {
          ok: false,
          needsRedeploy: true,
          error: 'Redeploy supabase/functions/artifax-sync/index.ts (v3) to Supabase first, then click Discover Artifax Schema again.',
        };
      }
      return data;
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }

  // ---------- Sync Diagnostics, Dry-Run & Schema Discovery Modal ----------
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

  function renderSchemaDiscoveryHtml(schemaResult) {
    const ui = RMTP.ui;
    if (!schemaResult) return '';
    if (!schemaResult.ok) {
      return (
        '<div class="p-3.5 rounded-xl bg-danger/10 border border-danger/30 text-xs text-ink">' +
          '<div class="font-semibold text-danger mb-1">Schema Discovery</div>' +
          '<div>' + ui.esc(schemaResult.error || 'Could not query Artifax schema.') + '</div>' +
        '</div>'
      );
    }

    const cfg = schemaResult.configuredWriteBack || {};
    const forms = Array.isArray(schemaResult.discoveredForms) ? schemaResult.discoveredForms : [];
    const docProbes = Array.isArray(schemaResult.documentEndpointProbes) ? schemaResult.documentEndpointProbes : [];

    // Find a form matching "Tech Portal" to generate ready-to-paste secrets command
    const portalForm = forms.find((f) => /tech\s*portal/i.test(String(f.name || '')));
    const findElemId = (f, re) => {
      if (!f || !Array.isArray(f.elements)) return '<ELEMENT_ID>';
      const m = f.elements.find((e) => re.test(String(e.name || '')));
      return m ? m.id : '<ELEMENT_ID>';
    };

    const secretFlags = [
      { key: 'ARTIFAX_PORTAL_FORM_ID', val: cfg.formId },
      { key: 'ARTIFAX_FIELD_TECH_NOTES_ID', val: cfg.techNotesFieldId },
      { key: 'ARTIFAX_FIELD_TIMINGS_ID', val: cfg.timingsFieldId },
      { key: 'ARTIFAX_FIELD_CREW_ID', val: cfg.crewFieldId },
      { key: 'ARTIFAX_FIELD_SPEC_SUMMARY_ID', val: cfg.specSummaryFieldId },
    ];

    const suggestedCmd = portalForm
      ? [
          `supabase secrets set ARTIFAX_PORTAL_FORM_ID="${portalForm.id}" \\`,
          `  ARTIFAX_FIELD_TECH_NOTES_ID="${findElemId(portalForm, /note|tech/i)}" \\`,
          `  ARTIFAX_FIELD_TIMINGS_ID="${findElemId(portalForm, /timing|schedule/i)}" \\`,
          `  ARTIFAX_FIELD_CREW_ID="${findElemId(portalForm, /crew|staff|tech/i)}" \\`,
          `  ARTIFAX_FIELD_SPEC_SUMMARY_ID="${findElemId(portalForm, /spec|summary|package/i)}"`,
        ].join('\n')
      : '';

    return (
      '<div class="border border-accent/30 rounded-xl p-3.5 bg-panel space-y-3">' +
        '<div class="flex items-center justify-between gap-2">' +
          '<div class="text-xs font-semibold uppercase tracking-wider text-accent">Artifax Write-Back &amp; Document Schema Probe</div>' +
          '<span class="text-[11px] font-mono text-muted">Sample Event ID: ' + ui.esc(schemaResult.sampleEventId || 'none') + '</span>' +
        '</div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">' +
          secretFlags.map((s) => (
            '<div class="flex items-center justify-between px-2.5 py-1.5 rounded bg-panel2 border border-line">' +
              '<code class="font-mono text-ink">' + ui.esc(s.key) + '</code>' +
              (s.val
                ? '<span class="text-ok font-semibold">Set (' + ui.esc(String(s.val)) + ')</span>'
                : '<span class="text-warning font-semibold">Not set</span>') +
            '</div>'
          )).join('') +
        '</div>' +
        (suggestedCmd ? (
          '<div class="p-2.5 rounded-lg bg-ok/10 border border-ok/30 text-[11px] space-y-1">' +
            '<div class="font-semibold text-ok">Found "Tech Portal" Custom Form! Copy these IDs into Supabase Edge Function Secrets:</div>' +
            '<pre class="font-mono text-[10px] overflow-x-auto p-2 rounded bg-bg border border-line text-ink">' + ui.esc(suggestedCmd) + '</pre>' +
          '</div>'
        ) : (
          '<div class="p-2.5 rounded-lg bg-panel2 border border-line text-xs text-muted">' +
            'No Custom Form named <strong class="text-ink">Tech Portal Advancing</strong> was found yet. Create it in Artifax (<strong class="text-ink">Admin → Configuration → Custom Forms</strong>), add the 4 text elements (<em>Portal Tech Notes</em>, <em>Technical Schedule &amp; Timings</em>, <em>Assigned Technical Crew</em>, <em>Spec &amp; Package Summary</em>), attach it to Events, then click <strong class="text-ink">Discover Artifax Schema</strong> again.' +
          '</div>'
        )) +
        (forms.length ? (
          '<div>' +
            '<div class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Discovered Custom Forms (' + forms.length + ')</div>' +
            '<div class="max-h-48 overflow-y-auto space-y-2">' +
              forms.map((f) => (
                '<div class="p-2.5 rounded-lg bg-panel2/70 border border-line text-xs">' +
                  '<div class="flex items-center justify-between gap-2 font-semibold text-ink">' +
                    '<span>' + ui.esc(f.name || '(unnamed form)') + '</span>' +
                    '<span class="font-mono text-[11px] text-accent">form_id: ' + ui.esc(String(f.id)) + '</span>' +
                  '</div>' +
                  (Array.isArray(f.elements) && f.elements.length ? (
                    '<div class="mt-1.5 grid gap-1 pl-2 border-l border-line">' +
                      f.elements.map((el) => (
                        '<div class="flex items-center justify-between text-[11px] text-muted">' +
                          '<span>' + ui.esc(el.name || '(element)') + (el.type ? ' <span class="opacity-70">(' + ui.esc(el.type) + ')</span>' : '') + '</span>' +
                          '<code class="font-mono text-ink">element_id: ' + ui.esc(String(el.id)) + '</code>' +
                        '</div>'
                      )).join('') +
                    '</div>'
                  ) : '<div class="text-[11px] text-muted italic mt-1">No elements returned on list probe (attach form to an upcoming event to inspect elements).</div>') +
                '</div>'
              )).join('') +
            '</div>' +
          '</div>'
        ) : '') +
        (docProbes.length ? (
          '<div>' +
            '<div class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Document Endpoint Probes</div>' +
            '<div class="grid gap-1 text-[11px]">' +
              docProbes.map((p) => (
                '<div class="flex items-center justify-between px-2 py-1 rounded bg-panel2 border border-line">' +
                  '<code class="font-mono text-ink truncate">' + ui.esc(p.path) + '</code>' +
                  '<span class="font-mono ' + (p.ok ? 'text-ok' : 'text-muted') + '">HTTP ' + ui.esc(String(p.status)) + (p.ok ? ' (' + (p.count || 0) + ' docs)' : '') + '</span>' +
                '</div>'
              )).join('') +
            '</div>' +
          '</div>'
        ) : '') +
      '</div>'
    );
  }

  function openDiagnosticsModal() {
    const ui = RMTP.ui;
    if (!ui) return;

    let currentSummary = lastSyncCache;
    let isPreview = false;
    let schemaResult = null;
    let isClosed = false;

    // Open synchronously — NEVER block the modal on a network call
    const m = ui.modal({
      title: 'Artifax Sync Diagnostics & Schema Setup',
      body: '<div id="afx-diag-root" class="space-y-4"></div>',
      size: 'md:max-w-3xl',
      footer:
        '<button type="button" id="afx-diag-schema" class="btn btn-ghost text-xs">' + ui.icon('search', 'w-3.5 h-3.5') + '<span>Discover Artifax Schema</span></button>' +
        '<button type="button" id="afx-diag-dryrun" class="btn btn-ghost text-xs">' + ui.icon('eye', 'w-3.5 h-3.5') + '<span>Run Dry-Run Preview</span></button>' +
        '<button type="button" id="afx-diag-sync" class="btn btn-primary text-xs">' + ui.icon('reset', 'w-3.5 h-3.5') + '<span>Sync Now</span></button>' +
        '<button type="button" data-close-diag class="btn btn-ghost text-xs">Close</button>',
    });

    const origClose = m.close;
    m.close = function () {
      isClosed = true;
      origClose();
    };

    const renderBody = () => {
      if (isClosed) return;
      const root = m.root.querySelector('#afx-diag-root');
      if (!root) return;

      const supCount = Object.keys(suppressedCache).length;
      const schemaHtml = renderSchemaDiscoveryHtml(schemaResult);

      if (!currentSummary) {
        root.innerHTML =
          schemaHtml +
          '<div class="p-4 rounded-xl bg-panel2 border border-line text-sm text-muted">' +
            '<p>No Artifax sync has been recorded yet. Run a <strong>Dry-Run Preview</strong> to inspect live Artifax statuses and rooms without changing any database records, click <strong>Discover Artifax Schema</strong> to read your Custom Form IDs for two-way write-back, or click <strong>Sync Now</strong>.</p>' +
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
            ' version. Redeploying <code class="font-mono">supabase/functions/artifax-sync/index.ts</code> enables server-side v3 sync, two-way write-back, PDF sync, and Schema Discovery.' +
          '</div>'
        ) : (Number(currentSummary.version || 2) < 3 ? (
          '<div class="p-3 rounded-lg bg-info/10 border border-info/30 text-xs text-ink leading-relaxed">' +
            '<strong class="text-info">Server Engine v2 Active:</strong> Pull sync, strict stage filtering, room mapping, and cleanup are running server-side. Redeploy <code class="font-mono">supabase/functions/artifax-sync/index.ts</code> (v3) whenever you are ready to enable <strong>Write-Back</strong>, <strong>Two-Way PDF Sync</strong>, and <strong>Discover Artifax Schema</strong>.' +
          '</div>'
        ) : '');

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
        schemaHtml +
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

    // Hydrate latest sync summary & suppression count in the background without blocking modal open
    hydrateFromDb().then(() => {
      if (!isClosed && !isPreview && lastSyncCache) {
        currentSummary = lastSyncCache;
        renderBody();
      } else if (!isClosed) {
        renderBody();
      }
    }).catch(() => {});

    const closeBtn = m.root.querySelector('[data-close-diag]');
    if (closeBtn) closeBtn.addEventListener('click', m.close);

    const schemaBtn = m.root.querySelector('#afx-diag-schema');
    if (schemaBtn) {
      schemaBtn.addEventListener('click', async () => {
        schemaBtn.disabled = true;
        schemaBtn.querySelector('span').textContent = 'Probing Artifax...';
        schemaResult = await discoverSchema();
        schemaBtn.disabled = false;
        schemaBtn.querySelector('span').textContent = 'Discover Artifax Schema';
        renderBody();
      });
    }

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
    isPortalOwnedCustomForm,
    stripPortalSentinelBlocks,
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
    // Part B: Two-Way Write-Back, PDF Sync & Schema Discovery
    buildPortalWritePayload,
    pushEvent,
    listDocuments,
    downloadDocument,
    openArtifaxDocument,
    uploadDocument,
    uploadEventTechSpecPdf,
    uploadGeneratedAdvancePdf,
    discoverSchema,
    openDiagnosticsModal,
  };
})();
