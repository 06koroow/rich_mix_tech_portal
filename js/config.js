/* ============================================================
   config.js — global namespace, app metadata & navigation
   ------------------------------------------------------------
   Everything hangs off the single global `RMTP`. View files
   register themselves onto RMTP.views. To add a new section,
   add an entry to RMTP.nav and create a matching view file.
   ============================================================ */
window.RMTP = window.RMTP || {};

RMTP.meta = {
  name: 'Rich Mix',
  product: 'Tech Portal',
  version: '1.0.0',
  storageKey: 'rmtp',   // localStorage namespace prefix
};

/* Navigation. `id` doubles as the route (#/inventory -> id "inventory")
   and the key used to look up RMTP.views[id].
   `icon` is a key into RMTP.ui.icon(). Order = display order. */
RMTP.nav = [
  { id: 'dashboard',   label: 'Dashboard',   icon: 'grid'  },
  { id: 'advancing',   label: 'Advancing',   icon: 'clip'  },
  { id: 'hires',       label: 'Hires Desk',  icon: 'chat'  },
  { id: 'dcp',         label: 'Pre-Screening Tracker', icon: 'film'  },
  { id: 'tasks',       label: 'Jobs & Tasks', icon: 'list' },
  { id: 'rota',        label: 'Rota & Shifts', icon: 'calendar' },
  { id: 'presets',     label: 'Patch & Preset Manager', icon: 'sliders' },
  { id: 'venues',      label: 'Venues & Spaces', icon: 'mapPin' },
  { id: 'maintenance', label: 'Maintenance', icon: 'wrench'},
  { id: 'inventory',   label: 'Inventory',   icon: 'box'   },
  { id: 'procedures',  label: 'Procedures',  icon: 'book'  },
  { id: 'guides',      label: 'User Guides', icon: 'file'  },
  { id: 'users',       label: 'Users',       icon: 'users' },
];

RMTP.HOME = 'dashboard';
RMTP.views = {};

/* ---- Shared vocabularies ----
   Spaces are the venue's finite performance areas — tagged on
   events, inventory (current location) and maintenance faults.
   Stores are the non-performance home locations kit lives in.
   Together they form the set of inventory locations. */
RMTP.DEFAULT_SPACES = ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three', 'Streetside', 'Cinema Bar', 'The Lab'];
RMTP.SPACES = ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three', 'Streetside', 'Cinema Bar', 'The Lab'];
RMTP.STORES = ['Store', 'Cable store', 'PA rack', 'RF case', 'Stage store', 'Workshop'];
RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES);
RMTP.EVENT_CATEGORIES = ['Cinema', 'Programme', 'Private Hires', 'DCP Test', 'Maintenance', 'Maintenance Shift'];
RMTP.MEDIA_TYPES = ['DCP', 'Laptop via HDMI', 'Blu-Ray', 'HDMI (Other)'];
RMTP.isSpace = function (loc) { return RMTP.SPACES.indexOf(loc) > -1; };
RMTP.slug = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

/* Canonical date normalizer to standard ISO YYYY-MM-DD format (handles UK DD/MM/YYYY, ISO, and Date strings) */
RMTP.normalizeDateStr = function (raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    try {
      const london = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      if (/^\d{4}-\d{2}-\d{2}$/.test(london)) return london;
    } catch (e) {}
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return s.slice(0, 10);
};

/* ---- Shift roles & Technical Disciplines ----
   Per-shift role a tagged technician is covering on an event —
   distinct from a user's job title (position). An event can carry
   several technicians, each with their own role for that shift. */
RMTP.SHIFT_ROLES = ['Sound', 'Lighting', 'Sound & Lighting', 'Cinema', 'AV', 'Stage', 'Support', 'Duty Manager'];
RMTP.DISCIPLINES = ['Sound', 'Lighting', 'Cinema', 'AV', 'Stage', 'Support', 'Duty Manager'];

/* Multi-role / selective understaffing helpers:
   Supports a single technician covering multiple disciplines on one shift
   (e.g. "Sound & Lighting") and collapses duplicate role bookings cleanly. */
RMTP.parseShiftRoles = function (roleStr) {
  if (!roleStr) return [];
  const rawList = Array.isArray(roleStr)
    ? roleStr
    : String(roleStr).split(/\s*(?:&|\+|\/|,|\band\b)\s*/i);
  const seen = new Set();
  const out = [];
  rawList.forEach((part) => {
    const clean = String(part || '').trim();
    if (!clean || /^none$/i.test(clean)) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
};

RMTP.mergeShiftRoles = function () {
  const order = ['sound', 'lighting', 'cinema', 'av', 'stage', 'support', 'duty manager'];
  const seen = new Map();
  for (let i = 0; i < arguments.length; i++) {
    const parts = RMTP.parseShiftRoles(arguments[i]);
    parts.forEach((p) => {
      const k = p.toLowerCase();
      if (!seen.has(k)) seen.set(k, p);
    });
  }
  const list = Array.from(seen.values());
  if (!list.length) return 'Tech';
  list.sort((a, b) => {
    const ia = order.indexOf(a.toLowerCase());
    const ib = order.indexOf(b.toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  return list.join(' & ');
};

RMTP.roleCoversDiscipline = function (techRoleStr, requiredDiscipline) {
  const cr = String(requiredDiscipline || '').trim().toLowerCase();
  if (!cr) return false;
  const roles = RMTP.parseShiftRoles(techRoleStr);
  if (!roles.length) return false;
  return roles.some((r) => {
    const tr = r.toLowerCase();
    return tr === cr ||
      (cr.includes('sound') && tr.includes('sound')) ||
      (cr.includes('light') && tr.includes('light')) ||
      (cr.includes('cinema') && tr.includes('cinema')) ||
      (cr === 'av' && (tr === 'av' || tr.includes('audio visual'))) ||
      (cr.includes('stage') && tr.includes('stage')) ||
      (cr.includes('support') && tr.includes('support')) ||
      (cr.includes('duty') && tr.includes('duty'));
  });
};
RMTP.BOOKING_STATUSES = ['pencil', 'confirmed', 'declined', 'cancelled'];
RMTP.DAY_PARTS = [
  { id: 'all_day', label: 'All Day', start: '08:00', end: '23:30' },
  { id: 'morning', label: 'Morning', start: '08:00', end: '13:00' },
  { id: 'afternoon', label: 'Afternoon', start: '13:00', end: '18:00' },
  { id: 'evening', label: 'Evening', start: '18:00', end: '23:30' },
  { id: 'custom', label: 'Custom Hours', start: '', end: '' }
];

RMTP.CORE_SPACES = ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three', 'Screen 1', 'Screen 2', 'Screen 3'];
RMTP.CORE_SPACE_OPTIONS = ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three'];

RMTP.normalizeSpaceName = function (space) {
  const s = String(space || '').trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (low === 'screen 1' || low === 'screen one' || low === 'screen1') return 'Screen One';
  if (low === 'screen 2' || low === 'screen two' || low === 'screen2') return 'Screen Two';
  if (low === 'screen 3' || low === 'screen three' || low === 'screen3') return 'Screen Three';
  if (low === 'the stage' || low === 'stage') return 'The Stage';
  if (low === 'the studio' || low === 'studio') return 'The Studio';
  if (low === 'the mix' || low === 'mix') return 'The Mix';
  return s;
};

RMTP.isAuxiliarySpace = function (space) {
  if (!space) return false;
  const rawList = Array.isArray(space)
    ? space
    : String(space).split(/[,;&]+/);
  const list = rawList.map((s) => String(s || '').trim()).filter(Boolean);
  if (!list.length) return false;
  const coreSet = new Set([
    'the stage', 'stage', 'the studio', 'studio', 'the mix', 'mix',
    'screen one', 'screen two', 'screen three',
    'screen 1', 'screen 2', 'screen 3',
    'screen1', 'screen2', 'screen3'
  ]);
  // An event is auxiliary if all its assigned spaces are outside core spaces (e.g. Streetside, Cinema Bar, The Lab)
  return list.every((s) => !coreSet.has(s.toLowerCase()));
};

RMTP.isCoreSpace = function (space) {
  if (!space) return false;
  return !RMTP.isAuxiliarySpace(space);
};

RMTP.isTMOrST = function (u) {
  if (!u) return false;
  if (u.admin) return true;
  const pos = String(u.position || '').trim();
  const role = String(u.role || '').trim();
  if (pos === 'Technical Manager' || pos === 'Senior Tech') return true;
  if (/technical manager|tech manager/i.test(pos) || /senior tech/i.test(pos)) return true;
  if (/technical manager|tech manager/i.test(role) || /senior tech/i.test(role)) return true;
  if (RMTP.auth && RMTP.auth.isTechManager && RMTP.auth.isTechManager(u)) return true;
  if (RMTP.auth && RMTP.auth.isAdmin && RMTP.auth.isAdmin(u)) return true;
  return false;
};

/* Helper: Resolves minimum crew requirements and discipline breakdown for a room */
RMTP.getSpaceCrewSpecs = function (spaceName) {
  const defaultDisciplines = function (s) {
    if (RMTP.isAuxiliarySpace(s)) return [];
    const str = String(s || '').toLowerCase();
    if (str.includes('stage')) return [{ role: 'Sound', count: 1 }, { role: 'Lighting', count: 1 }];
    if (str.includes('studio')) return [{ role: 'Sound', count: 1 }, { role: 'Lighting', count: 1 }];
    if (str.includes('screen')) return [{ role: 'Cinema', count: 1 }];
    if (str.includes('mix')) return [{ role: 'Sound', count: 1 }];
    return [{ role: 'Sound', count: 1 }];
  };

  if (!spaceName) return { total: 1, disciplines: [{ role: 'Sound', count: 1 }], rolesList: ['Sound'], summary: '1x Sound' };

  let disciplines = [];
  const v = RMTP.store ? (RMTP.store.find('venues', spaceName) || (RMTP.store.all('venues') || []).find((x) => (x.name || x.id || '').trim().toLowerCase() === String(spaceName).trim().toLowerCase())) : null;

  if (v && Array.isArray(v.crewDisciplines) && v.crewDisciplines.length > 0) {
    disciplines = v.crewDisciplines.map((d) => ({
      role: d.role || d.discipline || 'Sound',
      count: Math.max(1, parseInt(d.count, 10) || 1),
    }));
  } else if (v && v.basicCrew !== undefined && v.basicCrew !== null && !isNaN(Number(v.basicCrew))) {
    const total = Math.max(0, parseInt(v.basicCrew, 10));
    const defs = defaultDisciplines(spaceName);
    const defTotal = defs.reduce((a, b) => a + b.count, 0);
    if (total === 0) {
      disciplines = [];
    } else if (total === defTotal) {
      disciplines = defs;
    } else if (total === 1) {
      disciplines = [{ role: defs[0] ? defs[0].role : 'Sound', count: 1 }];
    } else {
      disciplines = defs.map((d) => ({ ...d }));
      const diff = total - defTotal;
      if (diff > 0) {
        disciplines.push({ role: 'Support', count: diff });
      } else if (diff < 0) {
        disciplines = [{ role: defs[0] ? defs[0].role : 'Sound', count: total }];
      }
    }
  } else {
    disciplines = defaultDisciplines(spaceName);
  }

  const total = disciplines.reduce((sum, d) => sum + (parseInt(d.count, 10) || 0), 0);
  const rolesList = [];
  disciplines.forEach((d) => {
    for (let i = 0; i < (parseInt(d.count, 10) || 1); i++) rolesList.push(d.role);
  });
  const summary = disciplines.map((d) => `${d.count}x ${d.role}`).join(', ');

  return {
    total: Math.max(0, total),
    disciplines: disciplines,
    rolesList: rolesList,
    summary: summary || 'No crew required',
  };
};

/* Normalises an event's tagged crew, falling back to the legacy
   single `techUserId` field so events saved before multi-tagging
   existed still show/match correctly until re-saved. */
RMTP.eventTechnicians = function (ev) {
  if (ev && Array.isArray(ev.technicians) && ev.technicians.length) return ev.technicians;
  return ev && ev.techUserId ? [{ userId: ev.techUserId, role: '' }] : [];
};
RMTP.getAdvancingLeadId = function (ev) {
  if (!ev) return '';
  return ev.responsible_for_advancing || ev.responsible_for_advancing_user_id || ev.responsibleForAdvancingUserId || '';
};
RMTP.isAdvancingLead = function (ev, userId) {
  if (!ev || !userId) return false;
  return RMTP.getAdvancingLeadId(ev) === userId;
};
RMTP.eventAssignedTo = function (ev, userId) {
  if (!userId || !ev) return false;
  if (RMTP.isAdvancingLead(ev, userId)) return true;
  return RMTP.eventTechnicians(ev).some((t) => t.userId === userId);
};

/* Timezone-safe local YYYY-MM-DD helper (avoids UTC midnight date drift in BST/non-UTC zones) */
RMTP.localDateStr = function (d) {
  const dt = d instanceof Date ? d : new Date();
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
};

/* Standard helper for event selection dropdowns across the portal.
   Excludes past events, excludes cancelled events, and sorts in date order soonest first.
   Optionally preserves an already-selected event ID so existing links do not break. */
RMTP.getUpcomingActiveEvents = function (includeEventId = null) {
  const store = RMTP.store;
  if (!store || typeof store.all !== 'function') return [];
  const today = RMTP.localDateStr();
  const all = store.all('advancing') || [];

  return all.filter((e) => {
    if (!e || e.deleted) return false;
    if (includeEventId && e.id === includeEventId) return true;

    const s = String(e.status || '').trim().toLowerCase();
    if (s === 'cancelled' || s === 'canceled') return false;

    const d = RMTP.normalizeDateStr(e.date);
    if (!d || d < today) return false;

    return true;
  }).sort((a, b) => {
    const da = RMTP.normalizeDateStr(a.date) || '9999-99-99';
    const db = RMTP.normalizeDateStr(b.date) || '9999-99-99';
    if (da !== db) return da.localeCompare(db);
    const ta = a.startTime || '';
    const tb = b.startTime || '';
    if (ta !== tb) return ta.localeCompare(tb);
    return (a.name || '').localeCompare(b.name || '');
  });
};

/* Standard helper for cinema screening selection dropdowns.
   Excludes past screenings, excludes cancelled screenings, and sorts soonest first. */
RMTP.getUpcomingActiveScreenings = function (includeScreeningId = null) {
  const store = RMTP.store;
  if (!store || typeof store.all !== 'function') return [];
  const today = RMTP.localDateStr();
  const all = store.all('dcps') || [];
  const cancelledEventIds = new Set(
    (store.all('advancing') || [])
      .filter((e) => String(e.status || '').trim().toLowerCase() === 'cancelled' || String(e.status || '').trim().toLowerCase() === 'canceled')
      .map((e) => e.id)
  );

  return all.filter((d) => {
    if (!d) return false;
    if (includeScreeningId && d.id === includeScreeningId) return true;
    if (d.isCancelled || d.outcome === 'Cancelled') return false;
    if (d.eventId && cancelledEventIds.has(d.eventId)) return false;

    const dt = RMTP.normalizeDateStr(d.eventDate);
    if (!dt || dt < today) return false;

    return true;
  }).sort((a, b) => {
    const da = RMTP.normalizeDateStr(a.eventDate) || '9999-99-99';
    const db = RMTP.normalizeDateStr(b.eventDate) || '9999-99-99';
    if (da !== db) return da.localeCompare(db);
    const ta = a.eventStartTime || '';
    const tb = b.eventStartTime || '';
    if (ta !== tb) return ta.localeCompare(tb);
    return (a.filmTitle || a.eventName || '').localeCompare(b.filmTitle || b.eventName || '');
  });
};

/* Cancel all linked unworked Rota shifts for an event (upcoming or pencil shifts),
   while preserving historical past worked (confirmed) shifts for payroll/audit records. */
RMTP.cancelUnworkedShiftsForEvent = function (eventId, reason) {
  if (!eventId || !RMTP.store) return 0;
  const store = RMTP.store;
  const todayIso = RMTP.localDateStr();
  const nowIso = new Date().toISOString();
  const existingBookings = (store.all('bookings') || []).filter((b) => b && b.eventId === eventId);
  let cancelledCount = 0;

  existingBookings.forEach((b) => {
    const st = String(b.status || '').trim().toLowerCase();
    if (st === 'cancelled' || st === 'canceled') return;
    const shiftDate = RMTP.normalizeDateStr ? RMTP.normalizeDateStr(b.date) : String(b.date || '').slice(0, 10);
    const isPastWorked = !!shiftDate && shiftDate < todayIso && st === 'confirmed';
    if (isPastWorked) return;

    const updated = Object.assign({}, b, {
      status: 'cancelled',
      cancellationReason: reason || 'Event cancelled or removed in Artifax',
      cancelledAt: nowIso,
      updatedAt: nowIso,
    });
    store.upsert('bookings', updated);
    cancelledCount++;
  });

  return cancelledCount;
};

/* Auto-generate or sync draft rota shifts directly from event technical specs.
   Carries through venue minimum crew disciplines and supports 'No Tech Needed'. */
RMTP.syncAdvancingToRota = function (ev) {
  if (!ev || !RMTP.store) return [];
  const store = RMTP.store;
  const existingBookings = (store.all('bookings') || []).filter((b) => b.eventId === ev.id);
  const rawSpaces = Array.isArray(ev.spaces) && ev.spaces.length
    ? ev.spaces
    : (Array.isArray(ev.space)
      ? ev.space
      : String(ev.space || 'The Stage').split(/[,;]+/).map((s) => s.trim()).filter(Boolean));
  const spaces = rawSpaces.length
    ? rawSpaces.map((s) => (RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(s) : String(s).trim())).filter((s, i, arr) => s && arr.indexOf(s) === i)
    : ['The Stage'];
  const createdShifts = [];

  const stLower = String(ev.status || '').trim().toLowerCase();
  const isEvCancelled = ev.deleted === true || stLower === 'cancelled' || stLower === 'canceled';
  if (isEvCancelled) {
    RMTP.cancelUnworkedShiftsForEvent(ev.id, ev.deleted ? 'Event deleted in portal' : 'Event cancelled in Artifax');
    return [];
  }

  if (ev.noTechNeeded) {
    existingBookings.forEach((b) => store.remove('bookings', b.id));
    spaces.forEach((sp, idx) => {
      const booking = {
        id: 'b_notech_' + ev.id + '_' + idx,
        eventId: ev.id,
        eventName: ev.name || 'Self-Service Event',
        space: sp,
        date: ev.date,
        startTime: ev.startTime || '18:00',
        finishTime: ev.finishTime || '23:00',
        userId: '',
        userName: 'No Tech Required',
        role: 'None',
        status: 'confirmed',
        isNoTech: true,
        notes: ev.notes || ev.techInfo || 'No Tech Needed — Self-Service',
      };
      store.upsert('bookings', booking);
      createdShifts.push(booking);
    });
    return createdShifts;
  }

  // Remove previous no-tech placeholder if switching to tech
  existingBookings.filter((b) => b.isNoTech).forEach((b) => store.remove('bookings', b.id));

  const techs = RMTP.eventTechnicians(ev);
  if (techs.length > 0) {
    techs.forEach((t, idx) => {
      const isTechNoTech = !!t.isNoTech || t.role === 'None';
      const existing = existingBookings.find((b) => b.id === 'b_' + ev.id + '_' + idx) || existingBookings[idx];
      const allUsers = store.all('users') || [];
      const userObj = allUsers.find((u) => u.id === t.userId);
      const userName = isTechNoTech ? 'No Tech Required' : (t.freelancerName || (userObj ? (RMTP.auth ? RMTP.auth.displayName(userObj) : userObj.name) : (t.userId ? 'Tech' : 'Unassigned Tech')));
      const booking = {
        id: existing ? existing.id : 'b_' + ev.id + '_' + idx,
        eventId: ev.id,
        eventName: ev.name,
        space: (t.space && (RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(t.space) : t.space)) || spaces[0] || 'The Stage',
        date: ev.date,
        startTime: t.startTime || ev.startTime || '18:00',
        finishTime: t.finishTime || ev.finishTime || '23:00',
        userId: isTechNoTech ? '' : (t.userId || ''),
        userName: userName,
        role: isTechNoTech ? 'None' : (t.role || 'Tech'),
        status: isTechNoTech ? 'confirmed' : (t.bookingStatus || (t.userId ? 'confirmed' : 'pencil')),
        isNoTech: isTechNoTech,
        splitFromId: t.splitFromId || '',
        legIndex: t.legIndex || '',
        rate: t.rate || '',
        notes: t.notes || ev.notes || ev.techInfo || '',
      };
      store.upsert('bookings', booking);
      createdShifts.push(booking);
    });
    if (existingBookings.length > techs.length) {
      existingBookings.slice(techs.length).forEach((b) => store.remove('bookings', b.id));
    }
  } else {
    // Populate draft shifts directly from room minimum crew disciplines
    spaces.forEach((sp) => {
      const specs = RMTP.getSpaceCrewSpecs(sp);
      const disciplines = specs.disciplines && specs.disciplines.length ? specs.disciplines : [{ role: 'Sound', count: 1 }];
      let slotIdx = 0;
      disciplines.forEach((d) => {
        const count = parseInt(d.count, 10) || 1;
        for (let i = 0; i < count; i++) {
          const shiftId = 'b_' + ev.id + '_' + RMTP.slug(sp) + '_' + slotIdx;
          const existing = existingBookings.find((b) => b.id === shiftId);
          const booking = {
            id: existing ? existing.id : shiftId,
            eventId: ev.id,
            eventName: ev.name,
            space: sp,
            date: ev.date,
            startTime: ev.startTime || '18:00',
            finishTime: ev.finishTime || '23:00',
            userId: existing ? existing.userId : '',
            userName: existing && existing.userName ? existing.userName : 'Unassigned Tech',
            role: d.role || 'Tech',
            status: 'pencil',
            isNoTech: false,
            notes: ev.notes || ev.techInfo || '',
          };
          store.upsert('bookings', booking);
          createdShifts.push(booking);
          slotIdx++;
        }
      });
    });
  }
  return createdShifts;
};

/* Sync Rota shift bookings back onto the linked Advancing event record so
   Advancing cards, modals, Dashboard, and crew filters always stay in sync.
   opts: { prevBookingId, prevUserId, prevUserName } when editing/deleting/reassigning */
RMTP.syncRotaToAdvancing = function (eventId, opts) {
  if (!eventId || !RMTP.store) return null;
  const store = RMTP.store;
  const advEv = store.find('advancing', eventId);
  if (!advEv) return null;

  opts = opts || {};
  const allBookings = (store.all('bookings') || []).filter((b) => b.eventId === eventId);
  const activeBookings = allBookings.filter((b) => b.status !== 'cancelled' && b.status !== 'declined');

  const isPlaceholderName = (n) => {
    const s = String(n || '').trim().toLowerCase();
    return !s || s === 'unassigned' || s === 'unassigned tech' || s === 'no tech required';
  };

  const isNoTechBookingRecord = (b) => {
    if (!b) return false;
    return !!(b.isNoTech || b.role === 'None' || /^no tech/i.test(String(b.userName || '').trim()));
  };

  const assignedBookings = activeBookings.filter((b) => {
    if (isNoTechBookingRecord(b)) return false;
    return !!(b.userId || !isPlaceholderName(b.userName));
  });
  const noTechBookings = activeBookings.filter((b) => isNoTechBookingRecord(b));
  const placeholderBookings = activeBookings.filter((b) => !isNoTechBookingRecord(b) && !b.userId && isPlaceholderName(b.userName));

  // Explicit "Mark as No Tech Needed" override from Shift Booking modal:
  // remove leftover placeholder/crew bookings for the target space (or entire event if single-space)
  // and set Advancing to Self-Service when no other rooms retain assigned crew.
  if (opts.forceNoTech) {
    const normTargetSpace = opts.space ? (RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(opts.space) : String(opts.space).trim()).toLowerCase() : '';
    const matchesTargetSpace = (b) => {
      if (!normTargetSpace) return true;
      const bsp = (RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(b.space) : String(b.space || '').trim()).toLowerCase();
      return !bsp || bsp === normTargetSpace;
    };

    placeholderBookings.forEach((pb) => {
      if (matchesTargetSpace(pb)) store.remove('bookings', pb.id);
    });
    assignedBookings.forEach((ab) => {
      if (matchesTargetSpace(ab) && (!opts.keepBookingId || ab.id !== opts.keepBookingId)) {
        store.remove('bookings', ab.id);
      }
    });

    const remainingAssigned = assignedBookings.filter((ab) => !matchesTargetSpace(ab));
    if (remainingAssigned.length === 0) {
      const noTechTechEntry = {
        userId: '',
        role: 'None',
        isNoTech: true,
        isFreelancer: false,
        freelancerName: '',
        startTime: advEv.startTime || '',
        finishTime: advEv.finishTime || '',
        bookingStatus: 'confirmed',
      };
      const updatedEv = Object.assign({}, advEv, {
        noTechNeeded: true,
        techUserId: '',
        technicians: [noTechTechEntry],
      });
      store.upsert('advancing', updatedEv);
      return updatedEv;
    }
    // Multi-room event where another room still has assigned crew: fall through using remainingAssigned
  }

  const nextTechs = [];
  const coveredUserIds = new Set();
  const coveredFreelancers = new Set();
  const mergedTechByKey = new Map();

  // Re-read active assigned bookings after any forceNoTech space cleanup
  const effectiveAssignedBookings = (store.all('bookings') || []).filter((b) => {
    if (b.eventId !== eventId) return false;
    if (b.status === 'cancelled' || b.status === 'declined') return false;
    if (isNoTechBookingRecord(b)) return false;
    return !!(b.userId || !isPlaceholderName(b.userName));
  });

  effectiveAssignedBookings.forEach((b) => {
    const bSpace = RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(b.space) : (b.space || '');
    const isSplitLeg = !!(b.splitFromId || b.legIndex);
    const personKey = b.userId
      ? ('u:' + b.userId)
      : ('n:' + String(b.userName || '').trim().toLowerCase());
    const mergeKey = isSplitLeg
      ? (personKey + '|split|' + b.id)
      : (personKey + '|' + bSpace.toLowerCase());

    const existingMerged = mergedTechByKey.get(mergeKey);
    if (existingMerged) {
      existingMerged.role = RMTP.mergeShiftRoles ? RMTP.mergeShiftRoles(existingMerged.role, b.role) : (existingMerged.role || b.role || 'Tech');
      if (b.status === 'confirmed') existingMerged.bookingStatus = 'confirmed';
      return;
    }

    if (b.userId) {
      coveredUserIds.add(b.userId);
      const entry = {
        bookingId: b.id,
        userId: b.userId,
        space: bSpace,
        role: b.role || 'Tech',
        startTime: b.startTime || advEv.startTime || '',
        finishTime: b.finishTime || advEv.finishTime || '',
        bookingStatus: b.status || 'pencil',
        isFreelancer: false,
        freelancerName: '',
        splitFromId: b.splitFromId || '',
        legIndex: b.legIndex || '',
        rate: b.rate || '',
        notes: b.notes || '',
      };
      mergedTechByKey.set(mergeKey, entry);
      nextTechs.push(entry);
    } else if (!isPlaceholderName(b.userName)) {
      const fn = String(b.userName).trim();
      coveredFreelancers.add(fn.toLowerCase());
      const entry = {
        bookingId: b.id,
        userId: '',
        space: bSpace,
        isFreelancer: true,
        freelancerName: fn,
        role: b.role || 'Tech',
        startTime: b.startTime || advEv.startTime || '',
        finishTime: b.finishTime || advEv.finishTime || '',
        bookingStatus: b.status || 'pencil',
        splitFromId: b.splitFromId || '',
        legIndex: b.legIndex || '',
        rate: b.rate || '',
        notes: b.notes || '',
      };
      mergedTechByKey.set(mergeKey, entry);
      nextTechs.push(entry);
    }
  });

  // Preserve any pre-existing manual Advancing technicians that have no booking record yet
  // and were not the technician just removed/reassigned/cancelled.
  const removedBookingId = opts.prevBookingId || '';
  const removedUserId = opts.prevUserId || '';
  const removedUserName = String(opts.prevUserName || '').trim().toLowerCase();
  const existingTechs = Array.isArray(advEv.technicians) ? advEv.technicians : [];

  existingTechs.forEach((t) => {
    if (!t || t.isNoTech || t.role === 'None') return;
    if (removedBookingId && t.bookingId && t.bookingId === removedBookingId) return;
    if (t.bookingId && !effectiveAssignedBookings.some((b) => b.id === t.bookingId)) return;
    if (t.userId) {
      if (coveredUserIds.has(t.userId)) return;
      if (removedUserId && t.userId === removedUserId) return;
      coveredUserIds.add(t.userId);
      nextTechs.push(Object.assign({}, t, { isFreelancer: false }));
    } else if (t.freelancerName && !isPlaceholderName(t.freelancerName)) {
      const fnKey = String(t.freelancerName).trim().toLowerCase();
      if (coveredFreelancers.has(fnKey)) return;
      if (removedUserName && fnKey === removedUserName) return;
      coveredFreelancers.add(fnKey);
      nextTechs.push(Object.assign({}, t, { isFreelancer: true }));
    }
  });

  const updatedEv = Object.assign({}, advEv, {
    technicians: nextTechs,
    techUserId: nextTechs.find((t) => t.userId)?.userId || '',
  });

  if (effectiveAssignedBookings.length > 0) {
    updatedEv.noTechNeeded = false;
    // Clean up obsolete No-Tech placeholder bookings on spaces that now have real crew
    const spacesWithCrew = new Set(effectiveAssignedBookings.map((b) => (RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(b.space) : String(b.space || '').trim()).toLowerCase()));
    noTechBookings.forEach((ntb) => {
      const nsp = (RMTP.normalizeSpaceName ? RMTP.normalizeSpaceName(ntb.space) : String(ntb.space || '').trim()).toLowerCase();
      if (!nsp || spacesWithCrew.has(nsp)) store.remove('bookings', ntb.id);
    });
  } else if (noTechBookings.length > 0 && nextTechs.length === 0) {
    updatedEv.noTechNeeded = true;
    updatedEv.technicians = [{ userId: '', role: 'None', isNoTech: true, bookingStatus: 'confirmed' }];
    // Clean up stale unassigned placeholders so the event does not stay stuck in Needs Covering
    placeholderBookings.forEach((pb) => store.remove('bookings', pb.id));
  } else if (opts.clearNoTech) {
    updatedEv.noTechNeeded = false;
  }

  store.upsert('advancing', updatedEv);
  return updatedEv;
};

/* --- Shift Timing & Split Handover Utilities --- */
RMTP.parseMinutes = function (tStr) {
  if (!tStr || typeof tStr !== 'string') return 0;
  const parts = tStr.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
};

RMTP.formatMinutes = function (totalMinutes) {
  let m = Math.round(totalMinutes) % (24 * 60);
  if (m < 0) m += 24 * 60;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
};

RMTP.getShiftDurationHours = function (startTime, finishTime) {
  const startM = RMTP.parseMinutes(startTime || '10:00');
  let finishM = RMTP.parseMinutes(finishTime || '22:00');
  if (finishM <= startM) finishM += 24 * 60;
  return Math.round(((finishM - startM) / 60) * 10) / 10;
};

RMTP.calculateSplitTimes = function (startTime, finishTime, ratio = 0.5, overlapMinutes = 0) {
  const startM = RMTP.parseMinutes(startTime || '10:00');
  let finishM = RMTP.parseMinutes(finishTime || '22:00');
  if (finishM <= startM) finishM += 24 * 60;

  const totalM = finishM - startM;
  const splitM = Math.round(startM + totalM * ratio);
  const roundedSplitM = Math.round(splitM / 15) * 15;

  const leg1Start = RMTP.formatMinutes(startM);
  const leg1End = RMTP.formatMinutes(roundedSplitM + (overlapMinutes > 0 ? overlapMinutes : 0));
  const leg2Start = RMTP.formatMinutes(roundedSplitM);
  const leg2End = RMTP.formatMinutes(finishM);

  return {
    leg1Start,
    leg1End,
    leg2Start,
    leg2End,
    totalHours: Math.round((totalM / 60) * 10) / 10,
    leg1Hours: Math.round(((roundedSplitM + (overlapMinutes > 0 ? overlapMinutes : 0) - startM) / 60) * 10) / 10,
    leg2Hours: Math.round(((finishM - roundedSplitM) / 60) * 10) / 10,
    handoverTime: RMTP.formatMinutes(roundedSplitM),
  };
};

/* Conditions at or below this are "poor" — such kit is struck through
   in inventory and may only be moved to a Store (see inventory view). */
RMTP.CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor', 'Damaged', 'Out of service'];
RMTP.POOR_CONDITIONS = ['Poor', 'Damaged', 'Out of service'];
RMTP.isPoorCondition = function (c) { return RMTP.POOR_CONDITIONS.indexOf(c) > -1; };

/* ---- Training framework ----
   Space-specific competency categories. Sign-offs are recorded per
   (user, competency). Competency ids are derived from the slugs so
   they're stable across reloads. Edit this list to change what the
   team is signed off on. */
RMTP.TRAINING = [
  { category: 'The Stage (Sound)',    items: ['System startup & line check', 'FOH mixing', 'Monitors / IEM', 'Safe shutdown'] },
  { category: 'The Stage (Lighting)', items: ['Console startup', 'Operation / busking', 'Safe shutdown'] },
  { category: 'The Stage (AV)',       items: ['Projector & screen startup', 'Source switching / playback', 'Safe shutdown'] },
  { category: 'The Studio (Sound)',   items: ['System startup & line check', 'FOH mixing', 'Monitors / IEM', 'Safe shutdown'] },
  { category: 'The Studio (Lighting)',items: ['Console startup', 'Operation / busking', 'Safe shutdown'] },
  { category: 'The Studio (AV)',      items: ['Projector & screen startup', 'Source switching / playback', 'Safe shutdown'] },
  { category: 'The Mix (Sound)',      items: ['System startup & line check', 'FOH mixing', 'Safe shutdown'] },
  { category: 'The Mix (Lighting)',   items: ['Console startup', 'Operation / busking', 'Safe shutdown'] },
  { category: 'The Mix (AV)',         items: ['Projector & screen startup', 'Source switching / playback', 'Safe shutdown'] },
  { category: 'Cinema',               items: ['Screen One \u2014 Start Up/Shutdown', 'Screen Two \u2014 Start Up/Shutdown', 'Screen Three \u2014 Start Up/Shutdown', 'DCP Ingest & Playback', 'Sound/Format Check', 'Cinema Troubleshooting', 'Basic Projector Maintenance'] },
];

/* Flattened, most-recent-first log of kit movements across all items.
   Used by the Inventory page and the dashboard. */
RMTP.recentMovements = function (limit) {
  const out = [];
  RMTP.store.all('inventory').forEach((it) => {
    (it.movements || []).forEach((mv) => out.push({
      itemId: it.id, name: it.name, tag: it.tag,
      from: mv.from, to: mv.to, at: mv.at, by: mv.by, note: mv.note || '',
    }));
  });
  out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return limit ? out.slice(0, limit) : out;
};

/* ---- Per-event equipment booking & conflict resolution helpers ---- */
RMTP.equipmentBookings = {
  toMinutes: function (t) {
    if (!t || typeof t !== 'string' || !t.includes(':')) return null;
    const parts = t.split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  },

  timesOverlap: function (s1Raw, e1Raw, s2Raw, e2Raw) {
    const s1 = RMTP.equipmentBookings.toMinutes(s1Raw) ?? 0;
    let e1 = RMTP.equipmentBookings.toMinutes(e1Raw) ?? 1439;
    if (e1 <= s1) e1 += 1440; // overnight shift

    const s2 = RMTP.equipmentBookings.toMinutes(s2Raw) ?? 0;
    let e2 = RMTP.equipmentBookings.toMinutes(e2Raw) ?? 1439;
    if (e2 <= s2) e2 += 1440; // overnight shift

    return s1 < e2 && e1 > s2;
  },

  checkConflict: function (booking, excludeEventId, excludeBookingId) {
    const store = RMTP.store;
    if (!booking) return { hasConflict: false };
    const itemId = booking.itemId;
    const itemTag = (booking.itemTag || '').trim().toLowerCase();
    const itemName = (booking.itemName || '').trim().toLowerCase();
    const date = booking.date || '';
    const s1 = booking.startTime || '00:00';
    const e1 = booking.finishTime || '23:59';

    // 1. Check maintenance / service status
    if (itemId) {
      const fault = store.all('maintenance').find((f) => f.status !== 'Resolved' && f.itemId === itemId);
      const item = store.find('inventory', itemId);
      const isDamaged = item && (item.condition === 'Damaged' || item.condition === 'Out of service' || item.status === 'service' || item.location === 'SERVICE');
      if (fault || isDamaged) {
        return {
          hasConflict: true,
          type: 'maintenance',
          faultTitle: fault ? (fault.equipment || fault.description || 'Active Fault') : 'In SERVICE / Damaged',
          space: fault ? (fault.space || 'Workshop') : (item ? item.location : 'SERVICE'),
          status: fault ? fault.status : 'Out of service',
          date: date,
          startTime: 'All Day',
          finishTime: 'All Day',
          conflictMessage: 'Kit is under maintenance/service hold (' + (fault ? (fault.equipment || fault.description) : 'In SERVICE') + ')'
        };
      }
    }

    // 2. Check other advancing events on the same date
    if (!date) return { hasConflict: false };
    const allAdv = store.all('advancing').filter((e) => !e.deleted && String(e.status || '').trim().toLowerCase() !== 'cancelled' && e.id !== excludeEventId);
    for (const otherEv of allAdv) {
      const otherDate = otherEv.date || '';
      if (otherDate !== date) continue;

      const otherBookings = Array.isArray(otherEv.equipment_bookings)
        ? otherEv.equipment_bookings
        : (Array.isArray(otherEv.equipmentBookings) ? otherEv.equipmentBookings : []);

      for (const ob of otherBookings) {
        if (excludeBookingId && ob.id === excludeBookingId) continue;
        const matches = (ob.itemId && itemId && ob.itemId === itemId) ||
          (ob.itemTag && itemTag && ob.itemTag.trim().toLowerCase() === itemTag) ||
          (ob.itemName && itemName && ob.itemName.trim().toLowerCase() === itemName);
        if (!matches) continue;

        const s2 = ob.startTime || otherEv.startTime || '00:00';
        const e2 = ob.finishTime || otherEv.finishTime || '23:59';

        if (RMTP.equipmentBookings.timesOverlap(s1, e1, s2, e2)) {
          const otherSpace = Array.isArray(otherEv.space) ? otherEv.space.join(', ') : (otherEv.space || 'Venue Space');
          return {
            hasConflict: true,
            type: 'event',
            eventName: otherEv.name,
            space: otherSpace,
            date: otherDate,
            startTime: s2,
            finishTime: e2,
            qty: ob.qty || 1,
            existingOverride: !!ob.override,
            existingOverrideReason: ob.overrideReason || '',
            conflictMessage: 'Already allocated to "' + otherEv.name + '" in ' + otherSpace + ' (' + s2 + ' \u2013 ' + e2 + ')'
          };
        }
      }
    }
    return { hasConflict: false };
  },

  getBookingsForItem: function (itemOrId) {
    const store = RMTP.store;
    if (!itemOrId) return [];
    const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId;
    const targetItem = store.find('inventory', id) || (typeof itemOrId === 'object' ? itemOrId : null);
    const itemTag = targetItem ? String(targetItem.tag || '').trim().toLowerCase() : '';
    const itemName = targetItem ? String(targetItem.name || '').trim().toLowerCase() : '';

    const allAdv = store.all('advancing').filter((e) => !e.deleted && String(e.status || '').trim().toLowerCase() !== 'cancelled');
    const bookings = [];

    allAdv.forEach((ev) => {
      const list = Array.isArray(ev.equipment_bookings)
        ? ev.equipment_bookings
        : (Array.isArray(ev.equipmentBookings) ? ev.equipmentBookings : []);

      list.forEach((b) => {
        const matches = (b.itemId && b.itemId === id) ||
          (b.itemTag && itemTag && b.itemTag.trim().toLowerCase() === itemTag) ||
          (b.itemName && itemName && b.itemName.trim().toLowerCase() === itemName);

        if (matches) {
          bookings.push({
            booking: b,
            event: ev,
            id: b.id || (ev.id + '-' + (b.itemId || id)),
            eventId: ev.id,
            eventName: ev.name,
            space: Array.isArray(ev.space) ? ev.space.join(', ') : (ev.space || 'Venue Space'),
            date: b.date || ev.date || '',
            startTime: b.startTime || ev.startTime || '09:00',
            finishTime: b.finishTime || ev.finishTime || '23:00',
            qty: b.qty || 1,
            override: !!b.override,
            overrideReason: b.overrideReason || '',
            status: ev.status || 'Confirmed'
          });
        }
      });
    });

    bookings.sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      return d !== 0 ? d : (a.startTime || '').localeCompare(b.startTime || '');
    });

    return bookings;
  }
};

/* ---- Shared Subtasks & Main-Task Progress Helpers (Jobs & Tasks + Maintenance) ---- */
RMTP.SUBTASK_PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

RMTP.subtasks = (function () {
  const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

  function uid() {
    return 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function normalizeOne(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title || '').trim();
    if (!title) return null;
    const prio = RMTP.SUBTASK_PRIORITIES.indexOf(raw.priority) > -1 ? raw.priority : 'Medium';
    const dueDate = raw.dueDate
      ? (RMTP.normalizeDateStr ? RMTP.normalizeDateStr(raw.dueDate) : String(raw.dueDate).slice(0, 10))
      : '';
    const dueTime = String(raw.dueTime || '').trim();
    const completed = !!raw.completed;
    return {
      id: raw.id ? String(raw.id) : uid(),
      title: title,
      priority: prio,
      dueDate: dueDate,
      dueTime: dueTime,
      completed: completed,
      completedAt: completed ? (raw.completedAt || '') : '',
      completedBy: completed ? (raw.completedBy || '') : '',
      createdAt: raw.createdAt || new Date().toISOString(),
    };
  }

  function normalize(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    list.forEach((item) => {
      const n = normalizeOne(item);
      if (!n) return;
      if (seen.has(n.id)) n.id = uid();
      seen.add(n.id);
      out.push(n);
    });
    return out;
  }

  function priorityTextClass(prio) {
    if (prio === 'Urgent') return 'text-danger font-semibold';
    if (prio === 'High') return 'text-accent font-semibold';
    if (prio === 'Medium') return 'text-info font-medium';
    return 'text-muted';
  }

  function isSubtaskOverdue(sub, todayStr) {
    if (!sub || sub.completed || !sub.dueDate) return false;
    const today = todayStr || (RMTP.localDateStr ? RMTP.localDateStr() : new Date().toISOString().slice(0, 10));
    return sub.dueDate < today;
  }

  function computeProgress(record) {
    const list = normalize(record && record.subtasks);
    const total = list.length;
    const completed = list.filter((s) => s.completed).length;
    const remaining = total - completed;
    const status = String((record && record.status) || '').trim();
    const isMainDone = status === 'Completed' || status === 'Resolved';
    const isMainInProgress = status === 'In Progress' || status === 'In progress';

    let percent = 0;
    if (total > 0) {
      percent = Math.round((completed / total) * 100);
    } else if (isMainDone) {
      percent = 100;
    } else if (isMainInProgress) {
      percent = 50;
    } else {
      percent = 0;
    }

    const today = RMTP.localDateStr ? RMTP.localDateStr() : new Date().toISOString().slice(0, 10);
    let overdueCount = 0;
    let dueTodayCount = 0;
    let nextDeadline = '';
    let highestOpenPriority = '';
    let bestRank = 99;

    list.forEach((s) => {
      if (s.completed) return;
      if (s.dueDate) {
        if (s.dueDate < today) overdueCount++;
        else if (s.dueDate === today) dueTodayCount++;
        if (!nextDeadline || s.dueDate < nextDeadline) nextDeadline = s.dueDate;
      }
      const rank = PRIORITY_RANK[s.priority] !== undefined ? PRIORITY_RANK[s.priority] : 2;
      if (rank < bestRank) {
        bestRank = rank;
        highestOpenPriority = s.priority;
      }
    });

    return {
      list: list,
      total: total,
      completed: completed,
      remaining: remaining,
      percent: Math.max(0, Math.min(100, percent)),
      hasSubtasks: total > 0,
      isMainDone: isMainDone,
      overdueCount: overdueCount,
      dueTodayCount: dueTodayCount,
      nextDeadline: nextDeadline,
      highestOpenPriority: highestOpenPriority,
    };
  }

  /* Derives main task / maintenance status when linked subtasks change */
  function syncMainStatus(record, mode, actorName) {
    if (!record) return record;
    const list = normalize(record.subtasks);
    record.subtasks = list;
    if (!list.length) return record;

    const total = list.length;
    const completed = list.filter((s) => s.completed).length;
    const nowIso = new Date().toISOString();

    if (mode === 'maintenance') {
      if (completed === total) {
        record.status = 'Resolved';
        if (!record.resolvedAt) record.resolvedAt = Date.now();
      } else if (completed > 0) {
        if (record.status === 'Open' || record.status === 'Resolved' || !record.status) {
          record.status = 'In progress';
        }
        record.resolvedAt = null;
      } else {
        if (record.status === 'Resolved') {
          record.status = 'Open';
        }
        record.resolvedAt = null;
      }
    } else {
      if (completed === total) {
        record.status = 'Completed';
        record.completedAt = record.completedAt || nowIso;
        if (actorName && !record.completedBy) record.completedBy = actorName;
      } else if (completed > 0) {
        if (record.status === 'Pending' || record.status === 'Completed' || !record.status) {
          record.status = 'In Progress';
        }
        record.completedAt = null;
        record.completedBy = null;
      } else {
        if (record.status === 'Completed') {
          record.status = 'Pending';
        }
        record.completedAt = null;
        record.completedBy = null;
      }
    }
    return record;
  }

  /* Shared crisp progress bar HTML (zero pills, tabular numerals, color + text state) */
  function renderProgressBar(progress, opts) {
    const p = progress || { total: 0, completed: 0, percent: 0, hasSubtasks: false, overdueCount: 0 };
    const compact = !!(opts && opts.compact);
    const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
    const fillClass = pct === 100
      ? 'bg-ok'
      : (pct > 0 ? 'bg-accent' : 'bg-muted/30');
    const pctTextClass = pct === 100
      ? 'text-ok'
      : (pct > 0 ? 'text-ink' : 'text-muted');
    const statusLabel = (opts && opts.statusLabel) ? String(opts.statusLabel) : '';

    const detailParts = [];
    if (p.hasSubtasks) {
      detailParts.push(
        '<span class="font-mono tabular-nums">' + p.completed + '/' + p.total + '</span> ' +
        (p.total === 1 ? 'subtask' : 'subtasks')
      );
      if (p.overdueCount > 0) {
        detailParts.push(
          '<span class="text-danger font-semibold font-mono tabular-nums">' +
          p.overdueCount + ' overdue</span>'
        );
      }
    } else if (statusLabel) {
      detailParts.push('<span>' + (RMTP.ui ? RMTP.ui.esc(statusLabel) : statusLabel) + '</span>');
    } else {
      detailParts.push('<span>No subtasks</span>');
    }

    return (
      '<div class="flex items-center gap-3 ' + (compact ? 'w-full' : 'w-full') + '">' +
        '<div class="flex-1 min-w-[72px] ' + (compact ? 'h-1.5' : 'h-2') + ' rounded-full bg-panel2 border border-line/70 overflow-hidden" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="h-full rounded-full transition-all duration-300 ' + fillClass + '" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="flex items-center gap-1.5 shrink-0 ' + (compact ? 'text-[11px]' : 'text-xs') + ' text-muted">' +
          '<span class="font-mono tabular-nums font-semibold ' + pctTextClass + '">' + pct + '%</span>' +
          '<span class="text-line">\u00b7</span>' +
          detailParts.join('<span class="text-line">\u00b7</span>') +
        '</div>' +
      '</div>'
    );
  }

  return {
    uid,
    normalize,
    normalizeOne,
    priorityTextClass,
    isSubtaskOverdue,
    computeProgress,
    syncMainStatus,
    renderProgressBar,
  };
})();


