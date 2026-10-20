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
  { id: 'rota',        label: 'Rota & Shifts', icon: 'calendar' },
  { id: 'presets',     label: 'Patch & Preset Manager', icon: 'sliders' },
  { id: 'venues',      label: 'Venues & Spaces', icon: 'mapPin' },
  { id: 'maintenance', label: 'Maintenance', icon: 'wrench'},
  { id: 'inventory',   label: 'Inventory',   icon: 'box'   },
  { id: 'procedures',  label: 'Procedures',  icon: 'book'  },
  { id: 'users',       label: 'Users',       icon: 'users' },
];

RMTP.HOME = 'dashboard';
RMTP.views = {};

/* ---- Shared vocabularies ----
   Spaces are the venue's finite performance areas — tagged on
   events, inventory (current location) and maintenance faults.
   Stores are the non-performance home locations kit lives in.
   Together they form the set of inventory locations. */
RMTP.DEFAULT_SPACES = ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three'];
RMTP.SPACES = ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three'];
RMTP.STORES = ['Store', 'Cable store', 'PA rack', 'RF case', 'Stage store', 'Workshop'];
RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES);
RMTP.EVENT_CATEGORIES = ['Cinema', 'Programme', 'Private Hires', 'DCP Test', 'Maintenance', 'Maintenance Shift'];
RMTP.MEDIA_TYPES = ['DCP', 'Laptop via HDMI', 'Blu-Ray', 'HDMI (Other)'];
RMTP.isSpace = function (loc) { return RMTP.SPACES.indexOf(loc) > -1; };
RMTP.slug = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

/* ---- Shift roles & Technical Disciplines ----
   Per-shift role a tagged technician is covering on an event —
   distinct from a user's job title (position). An event can carry
   several technicians, each with their own role for that shift. */
RMTP.SHIFT_ROLES = ['Sound', 'Lighting', 'Cinema', 'AV', 'Stage', 'Support', 'Duty Manager'];
RMTP.DISCIPLINES = ['Sound', 'Lighting', 'Cinema', 'AV', 'Stage', 'Support', 'Duty Manager'];
RMTP.BOOKING_STATUSES = ['pencil', 'confirmed', 'declined', 'cancelled'];
RMTP.DAY_PARTS = [
  { id: 'all_day', label: 'All Day', start: '08:00', end: '23:30' },
  { id: 'morning', label: 'Morning', start: '08:00', end: '13:00' },
  { id: 'afternoon', label: 'Afternoon', start: '13:00', end: '18:00' },
  { id: 'evening', label: 'Evening', start: '18:00', end: '23:30' },
  { id: 'custom', label: 'Custom Hours', start: '', end: '' }
];

/* Helper: Resolves minimum crew requirements and discipline breakdown for a room */
RMTP.getSpaceCrewSpecs = function (spaceName) {
  const defaultDisciplines = function (s) {
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

/* Auto-generate or sync draft rota shifts directly from event technical specs.
   Carries through venue minimum crew disciplines and supports 'No Tech Needed'. */
RMTP.syncAdvancingToRota = function (ev) {
  if (!ev || !RMTP.store) return [];
  const store = RMTP.store;
  const existingBookings = (store.all('bookings') || []).filter((b) => b.eventId === ev.id);
  const spaces = Array.isArray(ev.space) ? ev.space : [ev.space || 'The Stage'];
  const createdShifts = [];

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
        space: spaces[0] || 'The Stage',
        date: ev.date,
        startTime: t.startTime || ev.startTime || '18:00',
        finishTime: t.finishTime || ev.finishTime || '23:00',
        userId: isTechNoTech ? '' : (t.userId || ''),
        userName: userName,
        role: isTechNoTech ? 'None' : (t.role || 'Tech'),
        status: isTechNoTech ? 'confirmed' : (t.bookingStatus || (t.userId ? 'confirmed' : 'pencil')),
        isNoTech: isTechNoTech,
        rate: t.rate || '',
        notes: t.notes || ev.notes || ev.techInfo || '',
      };
      store.upsert('bookings', booking);
      createdShifts.push(booking);
    });
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
    const allAdv = store.all('advancing').filter((e) => !e.deleted && e.id !== excludeEventId);
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

    const allAdv = store.all('advancing').filter((e) => !e.deleted);
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

