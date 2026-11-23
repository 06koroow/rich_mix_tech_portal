/* ============================================================
   views/dcp.js — Pre-Screening Tracker & Cinema QC Console
   ------------------------------------------------------------
   Canonical slot-level cinema QC engine + booth UI:
   - Auto-consolidates overlapping / duplicate Advancing bookings
     for the same (date, screen) into 1 canonical screening slot
     (distinct non-overlapping showtimes remain separate rows).
   - Persists tracker-only deletions via Supabase app_settings
     (`dcp_dismissed_screenings`) + localStorage cache so deleted
     screenings never resurrect on refresh or Artifax sync while
     leaving Event Advances untouched.
   - Two-way sync fans out updates to all linkedEventIds.
   ============================================================ */

(function initDcpEngine() {
  const MEDIA_TYPES = RMTP.MEDIA_TYPES || ['DCP', 'Laptop via HDMI', 'Blu-Ray', 'HDMI (Other)'];
  RMTP.MEDIA_TYPES = MEDIA_TYPES;

  const HARDWARE_MEDIA_BLOCKS = {
    'Screen One': 'Screen One — Barco DP2K-10S / Dolby IMS3000 (#IMS-884920)',
    'Screen Two': 'Screen Two — Christie CP2210 / Doremi DCP-2000 (#DOR-491208)',
    'Screen Three': 'Screen Three — NEC NC900C / GDC SR-1000 (#GDC-102944)'
  };
  RMTP.HARDWARE_MEDIA_BLOCKS = HARDWARE_MEDIA_BLOCKS;

  // Rich Mix Standardized 7-Parameter QC Test Criteria
  const QC_CRITERIA_DEFINITIONS = [
    {
      id: 'ingestion',
      num: 1,
      title: 'Ingestion & Integrity',
      requirement: 'DCP ingests without hash errors, missing assets, or corruption.',
      passDesc: 'Ingest completes at 100% with valid hash checks on all MXF files.',
      caveatsDesc: 'Minor slow read rate during ingest, but passes hash checks and completes fully.',
      failDesc: 'Ingest fails, corrupt asset, hash check error, or missing PKL / VOLINDEX files.'
    },
    {
      id: 'kdm',
      num: 2,
      title: 'KDM Validation',
      requirement: 'KDM matches cinema server certificate, correct screen, and covers the full screening timeframe.',
      passDesc: 'KDM is valid for target media block, active window covers test and showtime.',
      caveatsDesc: 'KDM window starts close to showtime (<2 hours buffer), but is confirmed active and working.',
      failDesc: 'KDM expired, incorrect server certificate / thumbprint mismatch, or wrong CPL.'
    },
    {
      id: 'cpl',
      num: 3,
      title: 'CPL Selection',
      requirement: 'Correct composition playlist selected (theatrical cut, correct language / audio config, rated version).',
      passDesc: 'Confirmed CPL matches booking specs (e.g. OV, VF, 5.1 audio, correct runtime).',
      caveatsDesc: 'CPL title differs slightly from paperwork but content & config are confirmed correct.',
      failDesc: 'Incorrect version loaded (e.g. wrong language track, incorrect cut or trailers).'
    },
    {
      id: 'framing',
      num: 4,
      title: 'Visual Framing & Ratios',
      requirement: 'Image displays in correct aspect ratio (Flat 1.85:1 or Scope 2.39:1) with appropriate masking and no distortion.',
      passDesc: 'Aspect ratio matches container exactly. No letterbox/pillarbox inside active picture area.',
      caveatsDesc: 'Mild keystoning or slight framing offset (<1%) that does not clip credits or picture.',
      failDesc: 'Wrong aspect ratio (e.g. Scope stretched into Flat), severe cropping, or improper lens macro.'
    },
    {
      id: 'audio',
      num: 5,
      title: 'Audio Mapping & Sync',
      requirement: 'Audio channels route correctly (L, C, R, LFE, Ls, Rs). Dialogue anchored to Center channel. In-sync with picture.',
      passDesc: 'Dialogue cleanly isolated to Center (ch 3). Surrounds and sub function. Lip-sync within ±20ms.',
      caveatsDesc: 'Dialogue slightly low/high in mix; fader offset adjusted. Minor sync variance (<45ms).',
      failDesc: 'Dialogue missing Center (L/R only), channels out of phase, severe lip-sync delay (>45ms), buzz or clipping.'
    },
    {
      id: 'subtitles',
      num: 6,
      title: 'Subtitles & Accessibility',
      requirement: 'Open captions / subtitles / timed text render at correct position, legible, in sync, with no font rendering errors.',
      passDesc: 'Subtitles positioned correctly above lower masking, legible, and synchronized with speech.',
      caveatsDesc: 'Font size slightly small or positioned slightly higher than standard, but fully legible.',
      failDesc: 'Subtitles missing entirely, garbled characters (encoding failure), overlapping lines, or out of sync.'
    },
    {
      id: 'playback',
      num: 7,
      title: 'Playback Stability',
      requirement: 'Test run through projector and sound processor shows no dropped frames, stutter, audio dropouts, or server lockups.',
      passDesc: 'Continuous playback for test duration (minimum head, tail, and spot checks) with 0 dropped frames.',
      caveatsDesc: 'Single momentary glitch during pre-show or non-critical content, verified clean on repeat.',
      failDesc: 'Playback stutter, frame freezing, audio dropouts, server reboot or crash during test.'
    }
  ];
  RMTP.QC_CRITERIA_DEFINITIONS = QC_CRITERIA_DEFINITIONS;

  const DISMISSED_STORAGE_KEY = 'rmtp_dcp_dismissed_screenings';
  const DISMISSED_APP_SETTING_KEY = 'dcp_dismissed_screenings';

  function getStore() { return RMTP.store; }
  function getAuth() { return RMTP.auth; }

  function ensureQcCriteria(dcp) {
    if (!dcp) return {};
    if (!dcp.qc_criteria || typeof dcp.qc_criteria !== 'object') {
      dcp.qc_criteria = {};
    }
    QC_CRITERIA_DEFINITIONS.forEach(def => {
      if (!dcp.qc_criteria[def.id] || typeof dcp.qc_criteria[def.id] !== 'object') {
        let status = 'Pending';
        if (dcp.tested) {
          if (dcp.outcome === 'Passed') status = 'Pass';
          else if (dcp.outcome === 'Passed with Caveats') status = (def.id === 'framing' || def.id === 'audio') ? 'Caveats' : 'Pass';
          else if (dcp.outcome === 'Failed') status = (def.id === 'playback' || def.id === 'kdm') ? 'Fail' : 'Pass';
        }
        if (def.id === 'ingestion' && dcp.mediaReceived) status = 'Pass';
        if (def.id === 'kdm' && dcp.kdmCplReceived) status = 'Pass';
        if (def.id === 'cpl' && dcp.playlistMade) status = 'Pass';
        if (def.id === 'audio' && dcp.subsAudioSync) status = 'Pass';
        if (def.id === 'subtitles' && dcp.subsAudioSync) status = 'Pass';

        dcp.qc_criteria[def.id] = {
          status: status,
          notes: ''
        };
      }
    });
    return dcp.qc_criteria;
  }
  RMTP.ensureQcCriteria = ensureQcCriteria;

  function calculateOverallQcOutcome(criteriaMap) {
    if (!criteriaMap) return 'Pending';
    const entries = QC_CRITERIA_DEFINITIONS.map(def => criteriaMap[def.id]).filter(Boolean);
    if (!entries.length) return 'Pending';

    const anyFail = entries.some(e => e && e.status === 'Fail');
    if (anyFail) return 'Failed';

    const anyCaveat = entries.some(e => e && e.status === 'Caveats');
    const allPass = entries.length >= QC_CRITERIA_DEFINITIONS.length && entries.every(e => e && e.status === 'Pass');
    if (allPass) return 'Passed';
    if (anyCaveat && !anyFail) return 'Passed with Caveats';

    const allChecked = entries.length >= QC_CRITERIA_DEFINITIONS.length && entries.every(e => e && (e.status === 'Pass' || e.status === 'Caveats'));
    if (allChecked) return anyCaveat ? 'Passed with Caveats' : 'Passed';

    return 'Pending';
  }
  RMTP.calculateOverallQcOutcome = calculateOverallQcOutcome;

  function getTodayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getNowLocalDateTime() {
    const d = new Date();
    return getTodayIso() + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function normalizeEventDate(raw) {
    if (!raw) return '';
    if (RMTP.normalizeDateStr) return RMTP.normalizeDateStr(raw);
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s;
  }

  function parseTimeToMins(t) {
    if (t == null) return null;
    const s = String(t).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 29 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  function formatMinsToHHMM(mins) {
    if (mins == null || isNaN(mins)) return '';
    const norm = ((mins % 1440) + 1440) % 1440;
    return String(Math.floor(norm / 60)).padStart(2, '0') + ':' + String(norm % 60).padStart(2, '0');
  }

  function parseUniqueSpaces(spaceVal) {
    const out = [];
    const seen = new Set();
    const pushItem = (val) => {
      if (val == null) return;
      if (Array.isArray(val)) {
        val.forEach(pushItem);
        return;
      }
      const str = String(val).trim();
      if (!str) return;
      if (str.startsWith('[') && str.endsWith(']')) {
        try {
          const parsed = JSON.parse(str);
          if (Array.isArray(parsed)) {
            parsed.forEach(pushItem);
            return;
          }
        } catch (e) { /* fall through */ }
      }
      str.split(/\s*(?:,|\/|\||&|\+)\s*/).forEach((part) => {
        const cleaned = part.trim();
        if (!cleaned) return;
        const key = cleaned.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(cleaned);
        }
      });
    };
    pushItem(spaceVal);
    return out;
  }

  function normalizeCinemaScreen(spaceName) {
    if (!spaceName) return '';
    const sLower = String(spaceName).trim().toLowerCase();
    if (!sLower || sLower.includes('cinema bar') || sLower.includes('bar') || sLower.includes('foyer')) {
      return '';
    }
    if (/\b(screen\s*3|screen\s*three|cinema\s*3|cinema\s*three)\b/.test(sLower)) return 'Screen Three';
    if (/\b(screen\s*2|screen\s*two|cinema\s*2|cinema\s*two)\b/.test(sLower)) return 'Screen Two';
    if (/\b(screen\s*1|screen\s*one|cinema\s*1|cinema\s*one)\b/.test(sLower)) return 'Screen One';
    return '';
  }

  function isDcpTestChildShift(ev) {
    if (!ev) return false;
    if (ev.dcp_parent_event_id) return true;
    if (String(ev.category || '').trim().toLowerCase() === 'dcp test') return true;
    if (/^dcp\s*test\s*:/i.test(String(ev.name || ev.title || '').trim())) return true;
    return false;
  }

  function isAdvancingEventCancelled(ev) {
    if (!ev) return false;
    const st = String(ev.status || '').trim().toLowerCase();
    return st === 'cancelled' || st === 'canceled';
  }

  function getCinemaScreensForEvent(ev) {
    if (!ev || ev.deleted || isDcpTestChildShift(ev)) return [];
    const screens = [];
    const addFrom = (val) => {
      parseUniqueSpaces(val).forEach((sp) => {
        const norm = normalizeCinemaScreen(sp);
        if (norm && !screens.includes(norm)) screens.push(norm);
      });
    };
    addFrom(ev.space);
    if (!screens.length && ev.room) addFrom(ev.room);
    if (screens.length) return screens;

    const media = String(ev.media_type || ev.mediaType || '').trim().toUpperCase();
    if (media === 'DCP' || ev.dcp_received === true || ev.dcpReceived === true) {
      return ['Screen One'];
    }
    return [];
  }

  function getAdvScreeningStartTime(ev) {
    if (!ev) return '';
    return ev.screening_starts || ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '';
  }

  function isCinemaSpace(sp) {
    if (!sp) return false;
    return parseUniqueSpaces(sp).some((s) => !!normalizeCinemaScreen(s));
  }
  RMTP.isCinemaSpace = isCinemaSpace;

  function userName(id) {
    if (!id) return '';
    const store = getStore(), auth = getAuth();
    const u = store && store.find ? store.find('users', id) : null;
    return u ? (auth && auth.displayName ? auth.displayName(u) : (u.name || id)) : id;
  }

  function resolveNormalizedScreen(sp, rm) {
    const fromSp = parseUniqueSpaces(sp).map(normalizeCinemaScreen).find(Boolean);
    if (fromSp) return fromSp;
    const fromRm = parseUniqueSpaces(rm).map(normalizeCinemaScreen).find(Boolean);
    if (fromRm) return fromRm;
    return 'Screen One';
  }

  function normalizeFilmTitle(title) {
    if (!title) return '';
    return String(title)
      .toLowerCase()
      .replace(/\b(screening|film|preview|dcp test|q&a|premiere|relaxed screening)\b/gi, '')
      .replace(/\([0-9]{1,2}[a-z]?\)/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }
  RMTP.normalizeFilmTitle = normalizeFilmTitle;

  function getDcpDedupKey(d) {
    if (!d) return '';
    const normTitle = normalizeFilmTitle(d.filmTitle || d.eventName || d.name || d.title);
    const normDate = normalizeEventDate(d.eventDate || d.date);
    const normScreen = resolveNormalizedScreen(d.screen || d.space, d.room);
    if (!normTitle) return '';
    return `${normTitle}|${normDate}|${normScreen}`;
  }
  RMTP.getDcpDedupKey = getDcpDedupKey;

  function computeSlotKey(title, date, screen, startTime) {
    const normDate = normalizeEventDate(date) || 'nodate';
    const normScreen = (normalizeCinemaScreen(screen) || resolveNormalizedScreen(screen)).toLowerCase().replace(/\s+/g, '');
    const startMins = parseTimeToMins(startTime);
    const timePart = startMins != null ? formatMinsToHHMM(startMins) : 'notime';
    const normTitle = normalizeFilmTitle(title) || 'untitled';
    return `${normDate}|${normScreen}|${timePart}|${normTitle}`;
  }

  function isManualScreeningRecord(d) {
    if (!d) return false;
    if (d.isManual === true) return true;
    if (!d.eventId && String(d.id || '').startsWith('dcp-manual-')) return true;
    return false;
  }

  function isDcpSignedOff(dcp) {
    if (!dcp) return false;
    const outcome = dcp.outcome || 'Pending';
    if (outcome === 'Pending') {
      return !!(dcp.tested && (dcp.reportGeneratedAt || dcp.lastReportId));
    }
    return (outcome === 'Passed' || outcome === 'Passed with Caveats' || outcome === 'Failed' || !!dcp.reportGeneratedAt || !!dcp.lastReportId);
  }
  RMTP.isDcpSignedOff = isDcpSignedOff;

  function getAllEventIdsForDcp(dcp) {
    const ids = [];
    const push = (id) => {
      const s = String(id || '').trim();
      if (s && !ids.includes(s)) ids.push(s);
    };
    if (!dcp) return ids;
    push(dcp.eventId);
    if (Array.isArray(dcp.linkedEventIds)) {
      dcp.linkedEventIds.forEach(push);
    }
    return ids;
  }

  /* ---- Persistent Tracker-Only Dismissal Registry (localStorage + Supabase app_settings) ---- */
  function normalizeDismissalState(raw) {
    if (!raw || typeof raw !== 'object') {
      return { updatedAt: 0, items: [] };
    }
    const items = Array.isArray(raw.items) ? raw.items.filter(Boolean).map((it) => ({
      key: String(it.key || it.slotKey || it.dcpId || ''),
      slotKey: String(it.slotKey || ''),
      eventIds: Array.isArray(it.eventIds) ? Array.from(new Set(it.eventIds.map(String).filter(Boolean))) : [],
      dcpId: String(it.dcpId || ''),
      title: String(it.title || 'Screening'),
      date: normalizeEventDate(it.date || ''),
      screen: String(it.screen || ''),
      startTime: String(it.startTime || ''),
      dismissedAt: String(it.dismissedAt || ''),
      dismissedBy: String(it.dismissedBy || '')
    })).filter((it) => it.key || it.slotKey || it.dcpId || it.eventIds.length > 0) : [];
    return {
      updatedAt: Number(raw.updatedAt || 0) || 0,
      items
    };
  }

  function readLocalDismissals() {
    try {
      const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
      if (!raw) return { updatedAt: 0, items: [] };
      return normalizeDismissalState(JSON.parse(raw));
    } catch (e) {
      return { updatedAt: 0, items: [] };
    }
  }

  let _dismissalCache = null;

  function getDismissalState() {
    if (!_dismissalCache) _dismissalCache = readLocalDismissals();
    return _dismissalCache;
  }

  function persistDismissalState(nextState, pushRemote) {
    const clean = normalizeDismissalState(nextState);
    _dismissalCache = clean;
    try {
      localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(clean));
    } catch (e) { /* ignore quota errors */ }
    if (pushRemote !== false && RMTP.syncSb && typeof RMTP.syncSb.setAppSetting === 'function') {
      RMTP.syncSb.setAppSetting(DISMISSED_APP_SETTING_KEY, clean).catch((err) => {
        console.warn('[Pre-Screening] Failed to sync dismissed screenings to app_settings:', err);
      });
    }
    return clean;
  }

  async function hydrateDismissalsFromDb() {
    const local = readLocalDismissals();
    _dismissalCache = local;
    if (!RMTP.syncSb || typeof RMTP.syncSb.getAppSetting !== 'function') {
      return local;
    }
    try {
      const remoteRaw = await RMTP.syncSb.getAppSetting(DISMISSED_APP_SETTING_KEY);
      if (remoteRaw && typeof remoteRaw === 'object') {
        const remote = normalizeDismissalState(remoteRaw);
        if (remote.updatedAt >= local.updatedAt) {
          persistDismissalState(remote, false);
          return remote;
        } else if (local.updatedAt > remote.updatedAt) {
          // Local has a newer dismissal/restore that hasn't finished reaching cloud yet
          persistDismissalState(local, true);
          return local;
        }
      } else if (local.items.length > 0 && local.updatedAt > 0) {
        persistDismissalState(local, true);
      }
    } catch (e) {
      console.warn('[Pre-Screening] hydrateDismissalsFromDb failed:', e && e.message);
    }
    return getDismissalState();
  }

  function buildDismissalSets() {
    const st = getDismissalState();
    const slotKeys = new Set();
    const eventIds = new Set();
    const dcpIds = new Set();
    st.items.forEach((it) => {
      if (it.slotKey) slotKeys.add(it.slotKey);
      if (it.dcpId) dcpIds.add(it.dcpId);
      if (Array.isArray(it.eventIds)) {
        it.eventIds.forEach((eid) => {
          if (eid) eventIds.add(String(eid));
        });
      }
    });
    return { slotKeys, eventIds, dcpIds };
  }

  function isSlotDismissed(slot) {
    if (!slot) return false;
    const { slotKeys, eventIds, dcpIds } = buildDismissalSets();
    if (!slotKeys.size && !eventIds.size && !dcpIds.size) return false;
    if (slot.slotKey && slotKeys.has(slot.slotKey)) return true;
    if (slot.canonicalId && dcpIds.has(slot.canonicalId)) return true;
    if (slot.linkedEventIds && slot.linkedEventIds.length > 0) {
      if (slot.linkedEventIds.every((eid) => eventIds.has(String(eid)))) return true;
    }
    return false;
  }

  function isDcpRowDismissed(row) {
    if (!row || isManualScreeningRecord(row)) return false;
    const { slotKeys, eventIds, dcpIds } = buildDismissalSets();
    if (!slotKeys.size && !eventIds.size && !dcpIds.size) return false;
    if (row.id && dcpIds.has(String(row.id))) return true;
    const rowSlotKey = row.slotKey || computeSlotKey(row.filmTitle || row.eventName, row.eventDate, row.screen, row.eventStartTime);
    if (rowSlotKey && slotKeys.has(rowSlotKey)) return true;
    const rowEvIds = getAllEventIdsForDcp(row);
    if (rowEvIds.length > 0 && rowEvIds.every((eid) => eventIds.has(String(eid)))) return true;
    return false;
  }

  function getDismissedScreenings() {
    return getDismissalState().items.slice().sort((a, b) => (b.dismissedAt || '').localeCompare(a.dismissedAt || ''));
  }

  /* ---- Overlap & Slot Consolidation Engine ---- */
  function getBaseArtifaxId(ev) {
    if (!ev) return '';
    const raw = String(ev.artifaxId || (String(ev.id || '').startsWith('evt-afx-') ? String(ev.id).slice(8) : '')).trim();
    if (!raw) return '';
    return raw.includes('__') ? raw.split('__')[0] : raw;
  }

  function getTimeBoundsForCinemaEntry(entry, sameTitle) {
    const startMins = parseTimeToMins(entry.startTime);
    let endMins = parseTimeToMins(entry.finishTime);
    if (startMins == null && endMins == null) return null;
    const s = startMins != null ? startMins : endMins;
    let e = endMins != null ? endMins : (s + (sameTitle ? 120 : 1));
    if (e <= s) e += 1440;
    return { s, e };
  }

  function cinemaEntriesOverlap(a, b) {
    if (!a || !b) return false;
    if (a.ev.id && b.ev.id && a.ev.id === b.ev.id) return true;

    const sameTitle = !!(a.normTitle && b.normTitle && a.normTitle === b.normTitle);
    const baseA = getBaseArtifaxId(a.ev);
    const baseB = getBaseArtifaxId(b.ev);
    const sameArtifaxBase = !!(baseA && baseB && baseA === baseB);

    const boundsA = getTimeBoundsForCinemaEntry(a, sameTitle);
    const boundsB = getTimeBoundsForCinemaEntry(b, sameTitle);

    // If either has no time bounds at all, only merge when titles or Artifax base ID match
    if (!boundsA || !boundsB) {
      return sameTitle || sameArtifaxBase;
    }

    // Identical start time in the same screen on the same day => always same screening slot
    if (boundsA.s === boundsB.s) return true;

    // Overlapping time ranges in the same cinema screen => physically same screening slot
    if (boundsA.s < boundsB.e && boundsB.s < boundsA.e) return true;

    return false;
  }

  function scoreAdvanceEventForSlot(ev) {
    let s = 0;
    if (!isAdvancingEventCancelled(ev)) s += 1000;
    if (ev.checks_completed || ev.checksCompleted) s += 80;
    if (ev.qc_status === 'Passed' || ev.dcp_qc_status === 'Passed') s += 60;
    if (ev.dcp_received || ev.dcpReceived) s += 40;
    if (ev.media_type || ev.mediaType) s += 30;
    if (ev.dcp_notes && String(ev.dcp_notes).trim()) s += 20;
    if (ev.screening_starts || ev.screening_starts_time || ev.screeningStartsTime) s += 15;
    if (ev.finishTime) s += 10;
    if (ev.startTime) s += 5;
    if (String(ev.id || '').startsWith('evt-afx-')) s += 8;
    else if (String(ev.id || '').startsWith('evt-')) s += 4;
    return s;
  }

  function buildSlotFromCluster(clusterEntries, absorbedCancelledIds) {
    const sorted = clusterEntries.slice().sort((a, b) => {
      const diff = scoreAdvanceEventForSlot(b.ev) - scoreAdvanceEventForSlot(a.ev);
      if (diff !== 0) return diff;
      return String(a.ev.id || '').localeCompare(String(b.ev.id || ''));
    });

    const primaryEntry = sorted[0];
    const primaryEv = primaryEntry.ev;
    const screen = primaryEntry.screen;
    const eventDate = primaryEntry.eventDate;

    const linkedEventIds = [];
    const allEventIds = [];
    const pushLinked = (id) => {
      const s = String(id || '').trim();
      if (!s) return;
      if (!linkedEventIds.includes(s)) linkedEventIds.push(s);
      if (!allEventIds.includes(s)) allEventIds.push(s);
    };

    clusterEntries.forEach((entry) => {
      pushLinked(entry.ev.id);
      if (Array.isArray(entry.ev._mergedIds)) {
        entry.ev._mergedIds.forEach(pushLinked);
      }
    });
    (absorbedCancelledIds || []).forEach((cid) => {
      const s = String(cid || '').trim();
      if (s && !allEventIds.includes(s)) allEventIds.push(s);
    });

    // Aggregate time span: earliest start, latest finish
    let minStart = null;
    let maxEnd = null;
    let bestStart = primaryEntry.startTime || '';
    let bestFinish = primaryEntry.finishTime || '';
    clusterEntries.forEach((entry) => {
      const s = parseTimeToMins(entry.startTime);
      const f = parseTimeToMins(entry.finishTime);
      if (s != null) {
        if (minStart == null || s < minStart) {
          minStart = s;
          bestStart = entry.startTime;
        }
        if (f != null) {
          const adjF = f <= s ? f + 1440 : f;
          if (maxEnd == null || adjF > maxEnd) {
            maxEnd = adjF;
            bestFinish = entry.finishTime;
          }
        }
      } else if (f != null && maxEnd == null) {
        maxEnd = f;
        bestFinish = entry.finishTime;
      }
    });

    // Aggregate Advancing cinema QC flags across all merged rows
    const evs = sorted.map((e) => e.ev);
    const evName = (primaryEv.name || primaryEv.title || 'Screening').trim();
    const mType = evs.map((e) => (e.media_type !== undefined ? e.media_type : (e.mediaType || ''))).find((v) => v && String(v).trim()) || '';
    const hasRecFlag = evs.some((e) => e.dcp_received !== undefined || e.dcpReceived !== undefined);
    const isRecFlag = evs.some((e) => !!(e.dcp_received !== undefined ? e.dcp_received : e.dcpReceived));
    const hasChecksFlag = evs.some((e) => e.checks_completed !== undefined || e.checksCompleted !== undefined);
    const isChecksFlag = evs.some((e) => !!(e.checks_completed !== undefined ? e.checks_completed : e.checksCompleted));

    const outcomeRank = { 'Passed': 4, 'Passed with Caveats': 3, 'Failed': 2, 'Pending': 1 };
    let advQcStatus = '';
    evs.forEach((e) => {
      const st = e.qc_status || e.dcp_qc_status || '';
      if (st && st !== 'Cancelled' && (outcomeRank[st] || 0) > (outcomeRank[advQcStatus] || 0)) {
        advQcStatus = st;
      }
    });

    let hasDcpNotesField = false;
    let cleanAdvNote = '';
    let artifaxDesc = '';
    evs.forEach((e) => {
      const desc = (e.techInfo || e.notes || e.artifaxNotes || '').trim();
      if (desc && !artifaxDesc) artifaxDesc = desc;
      if (e.dcp_notes !== undefined) {
        hasDcpNotesField = true;
        const candidate = (desc && String(e.dcp_notes).trim() === desc) ? '' : String(e.dcp_notes || '').trim();
        if (candidate && !cleanAdvNote) cleanAdvNote = candidate;
      }
    });

    const advClient = evs.map((e) => (e.clientContact || e.clientName || e.client || '').trim()).find(Boolean) || '';
    const advTesterId = evs.map((e) => e.dcp_tester_user_id || e.dcpTesterUserId || '').find(Boolean) || '';
    const advTestDt = evs.map((e) => e.dcp_test_datetime || e.dcpTestDatetime || '').find(Boolean) || '';
    const advFurtherAction = evs.map((e) => (e.further_action !== undefined ? e.further_action : (e.furtherAction || ''))).find((v) => v && String(v).trim()) || '';
    const advLinkedTask = evs.map((e) => e.linked_task_id || e.linkedTaskId || '').find(Boolean) || '';

    const primaryScreens = getCinemaScreensForEvent(primaryEv);
    const screenSlug = RMTP.slug ? RMTP.slug(screen) : screen.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const canonicalId = primaryScreens.length <= 1
      ? ('dcp-' + primaryEv.id)
      : ('dcp-' + primaryEv.id + '-' + screenSlug);

    const slotKey = computeSlotKey(evName, eventDate, screen, bestStart);
    const isCancelled = evs.every((e) => isAdvancingEventCancelled(e));

    return {
      canonicalId,
      slotKey,
      primaryEventId: primaryEv.id,
      primaryEv,
      linkedEventIds,
      allEventIds,
      screen,
      eventDate,
      evName,
      normTitle: normalizeFilmTitle(evName),
      evStart: bestStart,
      evFinish: bestFinish,
      mType,
      hasRecFlag,
      isRecFlag,
      hasChecksFlag,
      isChecksFlag,
      advQcStatus,
      hasDcpNotesField,
      cleanAdvNote,
      artifaxDesc,
      advClient,
      advTesterId,
      advTestDt,
      advFurtherAction,
      advLinkedTask,
      isCancelled
    };
  }

  function clusterCinemaEntriesByOverlap(entries) {
    if (!entries || entries.length <= 1) return entries ? entries.map((e) => [e]) : [];
    const n = entries.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (cinemaEntriesOverlap(entries[i], entries[j])) {
          union(i, j);
        }
      }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(entries[i]);
    }
    return Array.from(groups.values());
  }

  function buildConsolidatedCinemaSlots(allAdv) {
    const byDateScreen = new Map();

    (allAdv || []).forEach((ev) => {
      if (!ev || ev.deleted || isDcpTestChildShift(ev)) return;
      const screens = getCinemaScreensForEvent(ev);
      if (!screens.length) return;
      const eventDate = normalizeEventDate(ev.date);
      const startTime = getAdvScreeningStartTime(ev);
      const finishTime = ev.finishTime || '';
      const evName = (ev.name || ev.title || 'Screening').trim();
      const normTitle = normalizeFilmTitle(evName);

      screens.forEach((screen) => {
        const key = `${eventDate || 'nodate'}|${screen}`;
        if (!byDateScreen.has(key)) byDateScreen.set(key, []);
        byDateScreen.get(key).push({
          ev,
          screen,
          eventDate,
          startTime,
          finishTime,
          evName,
          normTitle,
          isCancelled: isAdvancingEventCancelled(ev)
        });
      });
    });

    const slots = [];
    byDateScreen.forEach((entries) => {
      const activeEntries = entries.filter((e) => !e.isCancelled);
      const cancelledEntries = entries.filter((e) => e.isCancelled);

      const activeClusters = clusterCinemaEntriesByOverlap(activeEntries);
      const absorbedPerCluster = activeClusters.map(() => []);
      const unabsorbedCancelled = [];

      cancelledEntries.forEach((ce) => {
        // If a cancelled booking physically overlaps an active booking in the same screen on the same day,
        // absorb its event ID so any legacy DCP row for the superseded booking gets cleanly merged/deleted
        // instead of showing a ghost cancelled row beside the active replacement.
        let matchedIdx = -1;
        for (let i = 0; i < activeClusters.length; i++) {
          if (activeClusters[i].some((ae) => cinemaEntriesOverlap(ae, ce))) {
            matchedIdx = i;
            break;
          }
        }
        if (matchedIdx > -1) {
          absorbedPerCluster[matchedIdx].push(ce.ev.id);
        } else {
          unabsorbedCancelled.push(ce);
        }
      });

      activeClusters.forEach((cl, idx) => {
        slots.push(buildSlotFromCluster(cl, absorbedPerCluster[idx]));
      });

      const cancelledClusters = clusterCinemaEntriesByOverlap(unabsorbedCancelled);
      cancelledClusters.forEach((cl) => {
        slots.push(buildSlotFromCluster(cl, []));
      });
    });

    return slots;
  }

  /* ---- Consolidate Multiple Existing DCP Rows Into One Winner ---- */
  function scoreDcpRecord(item, preferredId) {
    let s = 0;
    if (preferredId && item.id === preferredId) s += 20;
    if (item.outcome === 'Passed') s += 40;
    else if (item.outcome === 'Passed with Caveats') s += 30;
    else if (item.outcome === 'Failed') s += 20;
    if (item.tested) s += 25;
    if (item.lastReportId || item.reportGeneratedAt) s += 18;
    if (item.qc_criteria && typeof item.qc_criteria === 'object') {
      QC_CRITERIA_DEFINITIONS.forEach((def) => {
        const st = item.qc_criteria[def.id] && item.qc_criteria[def.id].status;
        if (st && st !== 'Pending') s += 4;
        if (item.qc_criteria[def.id] && item.qc_criteria[def.id].notes && item.qc_criteria[def.id].notes.trim()) s += 3;
      });
    }
    if (item.mediaReceived) s += 6;
    if (item.kdmCplReceived) s += 6;
    if (item.playlistMade) s += 6;
    if (item.subsAudioSync) s += 4;
    if (item.issuesNoted && item.issuesNoted.trim()) s += 8;
    if (item.furtherAction && item.furtherAction.trim()) s += 8;
    if (item.linkedTaskId) s += 10;
    if (item.eventId && String(item.eventId).startsWith('evt-')) s += 5;
    return s;
  }

  function mergeMultipleDcpRowsInMemory(rows, preferredId) {
    if (!rows || !rows.length) return { winner: null, losers: [] };
    if (rows.length === 1) return { winner: JSON.parse(JSON.stringify(rows[0])), losers: [] };

    const sorted = rows.slice().sort((a, b) => scoreDcpRecord(b, preferredId) - scoreDcpRecord(a, preferredId));
    const primary = JSON.parse(JSON.stringify(sorted[0]));
    const losers = sorted.slice(1);
    const critRank = { 'Fail': 4, 'Caveats': 3, 'Pass': 2, 'Pending': 1 };
    const outcomeRank = { 'Passed': 4, 'Passed with Caveats': 3, 'Failed': 2, 'Pending': 1 };

    ensureQcCriteria(primary);

    losers.forEach((other) => {
      if (!primary.eventId && other.eventId) primary.eventId = other.eventId;
      if (!primary.mediaType && other.mediaType) primary.mediaType = other.mediaType;
      if (!primary.clientName && other.clientName) primary.clientName = other.clientName;
      if (!primary.pictureFormat && other.pictureFormat) primary.pictureFormat = other.pictureFormat;
      if (!primary.audioFormat && other.audioFormat) primary.audioFormat = other.audioFormat;
      if (!primary.deadlineDate && other.deadlineDate) primary.deadlineDate = other.deadlineDate;
      if (!primary.eventStartTime && other.eventStartTime) primary.eventStartTime = other.eventStartTime;
      if (!primary.eventFinishTime && other.eventFinishTime) primary.eventFinishTime = other.eventFinishTime;

      if (other.mediaReceived) primary.mediaReceived = true;
      if (other.kdmCplReceived) primary.kdmCplReceived = true;
      if (other.playlistMade) primary.playlistMade = true;
      if (other.tested) primary.tested = true;
      if (other.holdingSlidesReady) primary.holdingSlidesReady = true;
      if (other.subsAudioSync) primary.subsAudioSync = true;

      if ((outcomeRank[other.outcome] || 0) > (outcomeRank[primary.outcome] || 0)) {
        primary.outcome = other.outcome;
      }

      if (other.qc_criteria && typeof other.qc_criteria === 'object') {
        QC_CRITERIA_DEFINITIONS.forEach((def) => {
          const oc = other.qc_criteria[def.id];
          const pc = primary.qc_criteria[def.id] || { status: 'Pending', notes: '' };
          if (oc && typeof oc === 'object') {
            if ((critRank[oc.status] || 0) > (critRank[pc.status] || 0)) {
              pc.status = oc.status;
            }
            if (oc.notes && oc.notes.trim()) {
              const note = oc.notes.trim();
              if (!pc.notes) pc.notes = note;
              else if (!pc.notes.includes(note)) pc.notes = pc.notes.trim() + '; ' + note;
            }
          }
          primary.qc_criteria[def.id] = pc;
        });
      }

      if (!primary.testedByUserId && other.testedByUserId) {
        primary.testedByUserId = other.testedByUserId;
        primary.testedByUserName = other.testedByUserName;
      }
      if (!primary.testDateTime && other.testDateTime) {
        primary.testDateTime = other.testDateTime;
      }
      if (!primary.lastReportId && other.lastReportId) {
        primary.lastReportId = other.lastReportId;
        primary.reportGeneratedAt = other.reportGeneratedAt || primary.reportGeneratedAt;
      }

      if (other.issuesNoted && other.issuesNoted.trim()) {
        const note = other.issuesNoted.trim();
        if (!primary.issuesNoted) primary.issuesNoted = note;
        else if (!primary.issuesNoted.includes(note)) primary.issuesNoted = primary.issuesNoted.trim() + '; ' + note;
      }
      if (other.furtherAction && other.furtherAction.trim()) {
        const act = other.furtherAction.trim();
        if (!primary.furtherAction) {
          primary.furtherAction = act;
          primary.hasFurtherAction = true;
        } else if (!primary.furtherAction.includes(act)) {
          primary.furtherAction = primary.furtherAction.trim() + '; ' + act;
          primary.hasFurtherAction = true;
        }
      }
      if (!primary.linkedTaskId && other.linkedTaskId) {
        primary.linkedTaskId = other.linkedTaskId;
      }
    });

    return { winner: primary, losers };
  }

  /* ---- Bi-directional Bridge: Pre-Screening Tracker -> Event Advancing (All Linked Events) ---- */
  function syncDcpToAdvance(dcp) {
    const store = getStore();
    if (!store || !dcp) return;
    const eventIds = getAllEventIdsForDcp(dcp);
    if (!eventIds.length) return;

    let anyChanged = false;
    eventIds.forEach((eid) => {
      const ev = store.find('advancing', eid);
      if (!ev || ev.deleted) return;
      let changed = false;

      const mt = dcp.mediaType !== undefined ? dcp.mediaType : '';
      if (ev.media_type !== mt || ev.mediaType !== mt) {
        ev.media_type = mt;
        ev.mediaType = mt;
        changed = true;
      }

      const isRec = !!dcp.mediaReceived;
      if (ev.dcp_received !== isRec || ev.dcpReceived !== isRec) {
        ev.dcp_received = isRec;
        ev.dcpReceived = isRec;
        changed = true;
      }

      const effectiveOutcome = dcp.outcome || 'Pending';
      const isPassed = effectiveOutcome === 'Passed';
      if (ev.checks_completed !== isPassed || ev.checksCompleted !== isPassed) {
        ev.checks_completed = isPassed;
        ev.checksCompleted = isPassed;
        changed = true;
      }

      if (ev.qc_status !== effectiveOutcome || ev.dcp_qc_status !== effectiveOutcome) {
        ev.qc_status = effectiveOutcome;
        ev.dcp_qc_status = effectiveOutcome;
        changed = true;
      }

      if (dcp.issuesNoted !== undefined && (ev.dcp_notes || '') !== (dcp.issuesNoted || '')) {
        ev.dcp_notes = dcp.issuesNoted || '';
        changed = true;
      }

      const testerId = dcp.testedByUserId || '';
      if ((ev.dcp_tester_user_id || '') !== testerId) {
        ev.dcp_tester_user_id = testerId;
        ev.dcpTesterUserId = testerId;
        changed = true;
      }

      const testDt = dcp.testDateTime || '';
      if ((ev.dcp_test_datetime || '') !== testDt) {
        ev.dcp_test_datetime = testDt;
        ev.dcpTestDatetime = testDt;
        changed = true;
      }

      const furtherAct = dcp.furtherAction || '';
      if ((ev.further_action || '') !== furtherAct) {
        ev.further_action = furtherAct;
        ev.furtherAction = furtherAct;
        changed = true;
      }

      const linkedTask = dcp.linkedTaskId || '';
      if ((ev.linked_task_id || '') !== linkedTask) {
        ev.linked_task_id = linkedTask;
        ev.linkedTaskId = linkedTask;
        changed = true;
      }

      if (changed) {
        store.upsert('advancing', ev);
        anyChanged = true;
      }
    });

    if (anyChanged && RMTP.syncSb && RMTP.syncSb.drain) {
      RMTP.syncSb.drain();
    }
  }
  RMTP.syncDcpToAdvance = syncDcpToAdvance;

  /* ---- Canonical Auto-Sync & Deduplication Engine ---- */
  let _syncingDcps = false;

  function dcpMatchesSlot(d, slot) {
    if (!d || isManualScreeningRecord(d)) return false;
    if (d.id === slot.canonicalId) return true;
    if (d.slotKey && d.slotKey === slot.slotKey) return true;

    const slotIdSet = new Set(slot.allEventIds);
    const dScreen = normalizeCinemaScreen(d.screen);
    const screenCompatible = !dScreen || dScreen === slot.screen;

    if (d.eventId && slotIdSet.has(String(d.eventId)) && screenCompatible) return true;
    if (Array.isArray(d.linkedEventIds) && d.linkedEventIds.some((eid) => slotIdSet.has(String(eid))) && screenCompatible) {
      return true;
    }
    for (let i = 0; i < slot.allEventIds.length; i++) {
      const eid = slot.allEventIds[i];
      if (d.id === 'dcp-' + eid || String(d.id || '').startsWith('dcp-' + eid + '-')) {
        if (screenCompatible) return true;
      }
    }

    // Legacy duplicate matching: same (normTitle, eventDate, screen) with overlapping or missing time
    const dDate = normalizeEventDate(d.eventDate);
    if (dDate && slot.eventDate && dDate === slot.eventDate && dScreen === slot.screen) {
      const dTitle = normalizeFilmTitle(d.filmTitle || d.eventName);
      if (dTitle && slot.normTitle && dTitle === slot.normTitle) {
        const dStart = parseTimeToMins(d.eventStartTime);
        const sStart = parseTimeToMins(slot.evStart);
        if (dStart == null || sStart == null || dStart === sStart) return true;
        const dEnd = parseTimeToMins(d.eventFinishTime) || (dStart + 120);
        const sEnd = parseTimeToMins(slot.evFinish) || (sStart + 120);
        const adjDEnd = dEnd <= dStart ? dEnd + 1440 : dEnd;
        const adjSEnd = sEnd <= sStart ? sEnd + 1440 : sEnd;
        if (dStart < adjSEnd && sStart < adjDEnd) return true;
      }
    }

    return false;
  }

  function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function syncAdvancingToDcps() {
    const store = getStore();
    if (!store) return [];
    if (_syncingDcps) return store.all('dcps') || [];
    _syncingDcps = true;

    try {
      const allAdv = (store.all('advancing') || []).filter((x) => x && !x.deleted);
      let dcps = (store.all('dcps') || []).slice();
      let modified = false;

      // 1. Purge legacy fake seed screenings
      dcps.forEach((d) => {
        if (d && String(d.id || '').startsWith('dcp-seed-')) {
          store.remove('dcps', d.id);
          modified = true;
        }
      });
      if (modified) dcps = (store.all('dcps') || []).slice();

      // 2. Build consolidated 1-row-per-screening-slot list from Advancing
      const slots = buildConsolidatedCinemaSlots(allAdv);
      const usedDcpIds = new Set();
      const validKeptIds = new Set();

      slots.forEach((slot) => {
        const matchingRows = dcps.filter((d) => d && !usedDcpIds.has(d.id) && dcpMatchesSlot(d, slot));

        // If user dismissed this screening slot from the tracker, purge any stray rows and skip
        if (isSlotDismissed(slot)) {
          matchingRows.forEach((row) => {
            usedDcpIds.add(row.id);
            store.remove('dcps', row.id);
            modified = true;
          });
          return;
        }

        let existing = null;
        if (matchingRows.length > 1) {
          const merged = mergeMultipleDcpRowsInMemory(matchingRows, slot.canonicalId);
          existing = merged.winner;
          merged.losers.forEach((loser) => {
            usedDcpIds.add(loser.id);
            store.remove('dcps', loser.id);
          });
          modified = true;
        } else if (matchingRows.length === 1) {
          existing = JSON.parse(JSON.stringify(matchingRows[0]));
        }

        if (existing) {
          usedDcpIds.add(existing.id);
          validKeptIds.add(existing.id);
          let changed = matchingRows.length > 1;

          if (existing.eventId !== slot.primaryEventId) { existing.eventId = slot.primaryEventId; changed = true; }
          if (!arraysEqual(existing.linkedEventIds, slot.linkedEventIds)) {
            existing.linkedEventIds = slot.linkedEventIds.slice();
            changed = true;
          }
          if (existing.slotKey !== slot.slotKey) { existing.slotKey = slot.slotKey; changed = true; }
          if (existing.isManual) { existing.isManual = false; changed = true; }
          if (existing._manualScreen) { existing._manualScreen = false; changed = true; }

          const prevEventName = existing.eventName || '';
          if (existing.eventName !== slot.evName) {
            existing.eventName = slot.evName;
            if (!existing.filmTitle || existing.filmTitle === prevEventName) {
              existing.filmTitle = slot.evName;
            }
            changed = true;
          }
          if (!existing.filmTitle) { existing.filmTitle = slot.evName; changed = true; }
          if (slot.advClient && !existing.clientName) { existing.clientName = slot.advClient; changed = true; }
          if (slot.mType && existing.mediaType !== slot.mType) { existing.mediaType = slot.mType; changed = true; }
          if (slot.eventDate && existing.eventDate !== slot.eventDate) { existing.eventDate = slot.eventDate; changed = true; }
          if ((existing.eventStartTime || '') !== slot.evStart) { existing.eventStartTime = slot.evStart; changed = true; }
          if ((existing.eventFinishTime || '') !== slot.evFinish) { existing.eventFinishTime = slot.evFinish; changed = true; }

          if (existing.screen !== slot.screen) {
            existing.screen = slot.screen;
            existing.targetHardware = HARDWARE_MEDIA_BLOCKS[slot.screen] || (slot.screen + ' Media Block');
            changed = true;
          } else if (!existing.targetHardware) {
            existing.targetHardware = HARDWARE_MEDIA_BLOCKS[slot.screen] || (slot.screen + ' Media Block');
            changed = true;
          }

          if (slot.isCancelled) {
            if (!existing.isCancelled || existing.outcome !== 'Cancelled') {
              existing.isCancelled = true;
              existing.outcome = 'Cancelled';
              changed = true;
            }
          } else {
            if (existing.isCancelled || existing.outcome === 'Cancelled') {
              existing.isCancelled = false;
              existing.outcome = slot.isChecksFlag ? 'Passed' : (slot.advQcStatus && slot.advQcStatus !== 'Cancelled' ? slot.advQcStatus : 'Pending');
              changed = true;
            }

            if (slot.hasRecFlag && existing.mediaReceived !== slot.isRecFlag) {
              existing.mediaReceived = slot.isRecFlag;
              if (existing.qc_criteria && existing.qc_criteria.ingestion) {
                if (slot.isRecFlag && existing.qc_criteria.ingestion.status === 'Pending') {
                  existing.qc_criteria.ingestion.status = 'Pass';
                } else if (!slot.isRecFlag && !existing.tested && existing.qc_criteria.ingestion.status === 'Pass') {
                  existing.qc_criteria.ingestion.status = 'Pending';
                }
              }
              changed = true;
            }

            if (slot.isChecksFlag) {
              if (existing.outcome !== 'Passed') { existing.outcome = 'Passed'; changed = true; }
              if (!existing.tested) { existing.tested = true; changed = true; }
            } else if (slot.advQcStatus && slot.advQcStatus !== 'Cancelled' && existing.outcome !== slot.advQcStatus) {
              existing.outcome = slot.advQcStatus;
              if (slot.advQcStatus === 'Pending') existing.tested = false;
              changed = true;
            } else if (slot.hasChecksFlag && !slot.isChecksFlag && existing.outcome === 'Passed' && slot.advQcStatus !== 'Passed') {
              existing.outcome = 'Pending';
              existing.tested = false;
              changed = true;
            }
          }

          // Decouple Technician Issues & Notes from Artifax Event Description
          if (slot.artifaxDesc && existing.issuesNoted && existing.issuesNoted.trim() === slot.artifaxDesc && !slot.cleanAdvNote) {
            existing.issuesNoted = '';
            changed = true;
          }
          if (slot.hasDcpNotesField && slot.cleanAdvNote && (existing.issuesNoted || '') !== slot.cleanAdvNote) {
            existing.issuesNoted = slot.cleanAdvNote;
            changed = true;
          }

          if (slot.advTesterId && existing.testedByUserId !== slot.advTesterId) {
            existing.testedByUserId = slot.advTesterId;
            existing.testedByUserName = userName(slot.advTesterId);
            changed = true;
          }
          if (slot.advTestDt && existing.testDateTime !== slot.advTestDt) {
            existing.testDateTime = slot.advTestDt;
            changed = true;
          }
          if (slot.advFurtherAction && existing.furtherAction !== slot.advFurtherAction) {
            existing.furtherAction = slot.advFurtherAction;
            existing.hasFurtherAction = true;
            changed = true;
          }
          if (slot.advLinkedTask && existing.linkedTaskId !== slot.advLinkedTask) {
            existing.linkedTaskId = slot.advLinkedTask;
            changed = true;
          }

          if (changed) {
            if (store.unmarkDeleted) store.unmarkDeleted('dcps', existing.id);
            existing.updatedAt = new Date().toISOString();
            store.upsert('dcps', existing);
            modified = true;
          }
        } else if (!slot.isCancelled) {
          const outcomeVal = slot.isChecksFlag ? 'Passed' : (slot.advQcStatus && slot.advQcStatus !== 'Cancelled' ? slot.advQcStatus : 'Pending');
          const newRec = {
            id: slot.canonicalId,
            eventId: slot.primaryEventId,
            linkedEventIds: slot.linkedEventIds.slice(),
            slotKey: slot.slotKey,
            isManual: false,
            eventName: slot.evName,
            filmTitle: slot.evName,
            clientName: slot.advClient,
            mediaType: slot.mType,
            eventDate: slot.eventDate,
            eventStartTime: slot.evStart,
            eventFinishTime: slot.evFinish,
            screen: slot.screen,
            targetHardware: HARDWARE_MEDIA_BLOCKS[slot.screen] || (slot.screen + ' Media Block'),
            mediaReceived: slot.isRecFlag,
            kdmCplReceived: (slot.mType === 'DCP' ? slot.isRecFlag : true),
            playlistMade: slot.isChecksFlag,
            tested: slot.isChecksFlag,
            holdingSlidesReady: false,
            subsAudioSync: slot.isChecksFlag,
            issuesNoted: slot.cleanAdvNote,
            outcome: outcomeVal,
            isCancelled: false,
            hasFurtherAction: !!slot.advFurtherAction,
            furtherAction: slot.advFurtherAction || '',
            linkedTaskId: slot.advLinkedTask || '',
            testedByUserId: slot.advTesterId,
            testedByUserName: userName(slot.advTesterId),
            testDateTime: slot.advTestDt,
            createdAt: slot.primaryEv.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          if (store.unmarkDeleted) store.unmarkDeleted('dcps', newRec.id);
          store.upsert('dcps', newRec);
          usedDcpIds.add(newRec.id);
          validKeptIds.add(newRec.id);
          modified = true;
        }
      });

      // 3. Prune orphaned / stale non-manual Advancing-linked rows (deleted events, moved out of screens, DCP Test child rows, dismissed slots)
      const currentDcps = (store.all('dcps') || []).slice();
      currentDcps.forEach((d) => {
        if (!d) return;
        if (isManualScreeningRecord(d)) return;
        if (!validKeptIds.has(d.id)) {
          store.remove('dcps', d.id);
          modified = true;
        }
      });

      return store.all('dcps') || [];
    } finally {
      _syncingDcps = false;
    }
  }
  RMTP.syncAdvancingToDcps = syncAdvancingToDcps;

  function syncAdvanceToDcp(ev) {
    if (!ev) return;
    // Always run the full deterministic slot reconciler so overlaps and dismissals stay 100% consistent
    syncAdvancingToDcps();
  }
  RMTP.syncAdvanceToDcp = syncAdvanceToDcp;

  function findDcpForEvent(eventId) {
    const store = getStore();
    if (!store || !eventId) return null;
    const eid = String(eventId);
    const list = store.all('dcps') || [];
    return list.find((d) =>
      d && (
        d.eventId === eid ||
        d.id === 'dcp-' + eid ||
        (Array.isArray(d.linkedEventIds) && d.linkedEventIds.includes(eid))
      )
    ) || null;
  }
  RMTP.findDcpForEvent = findDcpForEvent;

  /* ---- Watertight Tracker-Only Delete & Restore ---- */
  function dismissAndRemoveScreening(dcp) {
    const store = getStore(), auth = getAuth();
    if (!store || !dcp) return false;
    const wasSyncing = _syncingDcps;
    _syncingDcps = true;
    try {
      const isManual = isManualScreeningRecord(dcp);
      const dcpEventIds = getAllEventIdsForDcp(dcp);
      const slotKey = dcp.slotKey || computeSlotKey(dcp.filmTitle || dcp.eventName, dcp.eventDate, dcp.screen, dcp.eventStartTime);

      // Gather any extra overlapping Advancing event IDs for this exact slot so none of them can resurrect it
      const allIds = dcpEventIds.slice();
      if (!isManual) {
        const allAdv = (store.all('advancing') || []).filter((x) => x && !x.deleted);
        const slots = buildConsolidatedCinemaSlots(allAdv);
        slots.forEach((slot) => {
          if (slot.slotKey === slotKey || slot.canonicalId === dcp.id || slot.allEventIds.some((eid) => allIds.includes(eid))) {
            slot.allEventIds.forEach((eid) => {
              if (!allIds.includes(eid)) allIds.push(eid);
            });
          }
        });

        // Persist tracker-only dismissal (Event Advance stays completely untouched!)
        const curState = getDismissalState();
        const actor = auth && auth.current && auth.current() ? (auth.displayName ? auth.displayName(auth.current()) : (auth.current().name || 'Staff')) : 'Staff';
        const entryKey = slotKey || dcp.id;
        const filteredItems = curState.items.filter((it) => it.key !== entryKey && it.dcpId !== dcp.id);
        filteredItems.push({
          key: entryKey,
          slotKey: slotKey,
          eventIds: allIds,
          dcpId: dcp.id,
          title: dcp.filmTitle || dcp.eventName || 'Screening',
          date: normalizeEventDate(dcp.eventDate || ''),
          screen: dcp.screen || '',
          startTime: dcp.eventStartTime || '',
          dismissedAt: new Date().toISOString(),
          dismissedBy: actor
        });
        persistDismissalState({ updatedAt: Date.now(), items: filteredItems }, true);
      }

      // Delete the canonical DCP record AND any legacy duplicate siblings in the same slot
      const idsToDelete = new Set([dcp.id]);
      if (!isManual) {
        (store.all('dcps') || []).forEach((other) => {
          if (!other || other.id === dcp.id || isManualScreeningRecord(other)) return;
          const otherSlotKey = other.slotKey || computeSlotKey(other.filmTitle || other.eventName, other.eventDate, other.screen, other.eventStartTime);
          const otherEvIds = getAllEventIdsForDcp(other);
          if (otherSlotKey === slotKey || otherEvIds.some((eid) => allIds.includes(eid))) {
            idsToDelete.add(other.id);
          }
        });
      }

      idsToDelete.forEach((delId) => {
        store.remove('dcps', delId);
      });

      if (RMTP.syncSb && RMTP.syncSb.drain) {
        RMTP.syncSb.drain();
      }
      return true;
    } finally {
      _syncingDcps = wasSyncing;
    }
  }

  function restoreDismissedScreening(entryKey) {
    const store = getStore();
    const curState = getDismissalState();
    const target = curState.items.find((it) => it.key === entryKey || it.slotKey === entryKey || it.dcpId === entryKey);
    if (!target) return false;

    const nextItems = curState.items.filter((it) => it !== target);
    persistDismissalState({ updatedAt: Date.now(), items: nextItems }, true);

    if (store && store.unmarkDeleted) {
      if (target.dcpId) store.unmarkDeleted('dcps', target.dcpId);
      (target.eventIds || []).forEach((eid) => {
        store.unmarkDeleted('dcps', 'dcp-' + eid);
      });
    }

    syncAdvancingToDcps();
    if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
    return true;
  }

  function restoreAllDismissedScreenings() {
    const store = getStore();
    const curState = getDismissalState();
    if (!curState.items.length) return 0;
    const count = curState.items.length;

    if (store && store.unmarkDeleted) {
      curState.items.forEach((it) => {
        if (it.dcpId) store.unmarkDeleted('dcps', it.dcpId);
        (it.eventIds || []).forEach((eid) => store.unmarkDeleted('dcps', 'dcp-' + eid));
      });
    }

    persistDismissalState({ updatedAt: Date.now(), items: [] }, true);
    syncAdvancingToDcps();
    if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
    return count;
  }

  // Keep backwards-compatible stub so any external check sees zero duplicates after canonical reconciliation
  RMTP.findDuplicateClusters = function () {
    return { groups: [], duplicateIds: new Set(), dupGroupMap: new Map(), duplicateCount: 0 };
  };

  RMTP.dcpEngine = {
    MEDIA_TYPES,
    HARDWARE_MEDIA_BLOCKS,
    QC_CRITERIA_DEFINITIONS,
    ensureQcCriteria,
    calculateOverallQcOutcome,
    getTodayIso,
    getNowLocalDateTime,
    normalizeEventDate,
    normalizeCinemaScreen,
    resolveNormalizedScreen,
    isDcpTestChildShift,
    isAdvancingEventCancelled,
    isManualScreeningRecord,
    isDcpSignedOff,
    getAllEventIdsForDcp,
    userName,
    computeSlotKey,
    buildConsolidatedCinemaSlots,
    syncAdvancingToDcps,
    syncAdvanceToDcp,
    syncDcpToAdvance,
    findDcpForEvent,
    hydrateDismissalsFromDb,
    getDismissedScreenings,
    isSlotDismissed,
    isDcpRowDismissed,
    dismissAndRemoveScreening,
    restoreDismissedScreening,
    restoreAllDismissedScreenings,
    isSyncing: () => _syncingDcps
  };
})();

RMTP.views.dcp = function (el, params, query) {
  const ui = RMTP.ui, store = RMTP.store, auth = RMTP.auth;
  const eng = RMTP.dcpEngine;

  const curUser = auth.current();
  const isFreelancer = auth.isFreelancer ? auth.isFreelancer(curUser) : (curUser && curUser.position === 'Freelancer');
  if (isFreelancer) {
    el.innerHTML =
      '<div class="p-8 sm:p-12 max-w-lg mx-auto text-center animate-fadeIn">' +
        '<div class="w-16 h-16 rounded-2xl bg-danger/10 border border-danger/20 text-danger flex items-center justify-center mx-auto mb-4 shadow-sm">' +
          ui.icon('lock', 'w-8 h-8') +
        '</div>' +
        '<h1 class="font-display font-bold text-xl text-ink">Access Restricted</h1>' +
        '<p class="text-sm text-muted mt-2 leading-relaxed">' +
          'The Pre-Screening Tracker is restricted to Rich Mix staff technicians and managers. Freelancers do not have access to cinema server logs, KDM certificates, or technical QC sign-offs.' +
        '</p>' +
        '<div class="mt-6 flex justify-center gap-3">' +
          '<a href="#/' + RMTP.HOME + '" class="btn btn-primary px-4 py-2 text-sm flex items-center gap-2">' +
            ui.icon('calendar', 'w-4 h-4') + '<span>Return to Event Advancing</span>' +
          '</a>' +
        '</div>' +
      '</div>';
    return;
  }

  const MEDIA_TYPES = eng.MEDIA_TYPES;
  const HARDWARE_MEDIA_BLOCKS = eng.HARDWARE_MEDIA_BLOCKS;
  const QC_CRITERIA_DEFINITIONS = eng.QC_CRITERIA_DEFINITIONS;
  const ensureQcCriteria = eng.ensureQcCriteria;
  const calculateOverallQcOutcome = eng.calculateOverallQcOutcome;
  const getTodayIso = eng.getTodayIso;
  const getNowLocalDateTime = eng.getNowLocalDateTime;
  const normalizeCinemaScreen = eng.normalizeCinemaScreen;
  const isAdvancingEventCancelled = eng.isAdvancingEventCancelled;
  const isManualScreeningRecord = eng.isManualScreeningRecord;
  const isDcpSignedOff = eng.isDcpSignedOff;
  const getAllEventIdsForDcp = eng.getAllEventIdsForDcp;
  const syncDcpToAdvance = eng.syncDcpToAdvance;
  const syncAdvancingToDcps = eng.syncAdvancingToDcps;

  function getAssignedCrewSummary(dcp, advEv) {
    const names = [];
    const seen = new Set();
    const addName = (n) => {
      const clean = String(n || '').trim();
      if (!clean || /^unassigned(\s+tech)?$/i.test(clean) || /^no tech/i.test(clean)) return;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        names.push(clean);
      }
    };
    const allUsers = store.all('users') || [];
    const evIds = getAllEventIdsForDcp(dcp);
    if (evIds.length) {
      const evIdSet = new Set(evIds);
      const targetScreen = normalizeCinemaScreen(dcp.screen);
      const bookings = (store.all('bookings') || []).filter((b) => {
        if (!b || b.deleted || !evIdSet.has(String(b.eventId || ''))) return false;
        const st = String(b.status || '').toLowerCase();
        if (st === 'cancelled' || st === 'declined') return false;
        if (b.isNoTech || b.role === 'None') return false;
        const bScreen = normalizeCinemaScreen(b.space);
        if (targetScreen && bScreen && bScreen !== targetScreen) return false;
        return true;
      });
      bookings.forEach((b) => {
        const u = b.userId ? allUsers.find((x) => x.id === b.userId) : null;
        addName(u ? auth.displayName(u) : b.userName);
      });
    }
    if (!names.length && RMTP.eventTechnicians) {
      const evObjs = [];
      if (advEv) evObjs.push(advEv);
      evIds.forEach((eid) => {
        if (!advEv || advEv.id !== eid) {
          const otherEv = store.find('advancing', eid);
          if (otherEv) evObjs.push(otherEv);
        }
      });
      evObjs.forEach((evObj) => {
        RMTP.eventTechnicians(evObj).forEach((t) => {
          if (!t || t.isNoTech || t.role === 'None') return;
          const st = String(t.bookingStatus || '').toLowerCase();
          if (st === 'cancelled' || st === 'declined') return;
          const u = t.userId ? allUsers.find((x) => x.id === t.userId) : null;
          addName(u ? auth.displayName(u) : t.freelancerName);
        });
      });
    }
    return names;
  }

  /* ---- Create / Link Task in Jobs List ---- */
  function createOrUpdateFollowUpTask(screening, actionText) {
    if (!screening || !actionText || !actionText.trim()) return null;
    const text = actionText.trim();
    let task = null;

    if (screening.linkedTaskId) {
      task = store.find('tasks', screening.linkedTaskId);
      if (!task) {
        const legacyMaint = store.find('maintenance', screening.linkedTaskId);
        if (legacyMaint) {
          task = {
            id: 'task-' + legacyMaint.id.replace('fault-', ''),
            title: (screening.filmTitle || screening.eventName || 'Cinema') + ' — Pre-Screening Follow-up',
            description: text + (screening.issuesNoted ? '\n\nIssues noted: ' + screening.issuesNoted.trim() : ''),
            category: 'Cinema & DCP',
            space: screening.screen || 'Screen One',
            priority: screening.outcome === 'Failed' ? 'Urgent' : (screening.outcome === 'Passed with Caveats' ? 'High' : 'Medium'),
            status: 'Pending',
            assignedTechId: screening.testedByUserId || '',
            assignedTechName: screening.testedByUserName || '',
            reportedBy: auth.displayName(auth.current()) || 'Cinema Tech',
            source: 'dcp_test',
            linkedScreeningId: screening.id,
            linkedEventId: screening.eventId || '',
            filmTitle: screening.filmTitle || screening.eventName || '',
            screen: screening.screen || 'Screen One',
            dueDate: screening.eventDate || '',
            dueTime: screening.eventStartTime || '',
            mediaType: screening.mediaType || '',
            createdAt: legacyMaint.createdAt || Date.now(),
            updatedAt: Date.now()
          };
          store.upsert('tasks', task);
          screening.linkedTaskId = task.id;
        }
      }
    }

    if (task) {
      task.description = text + (screening.issuesNoted ? '\n\nIssues noted: ' + screening.issuesNoted.trim() : '');
      task.space = screening.screen || 'Screen One';
      task.filmTitle = screening.filmTitle || screening.eventName || '';
      task.screen = screening.screen || 'Screen One';
      task.dueDate = screening.eventDate || '';
      task.dueTime = screening.eventStartTime || '';
      task.priority = screening.outcome === 'Failed' ? 'Urgent' : (screening.outcome === 'Passed with Caveats' ? 'High' : 'Medium');
      task.updatedAt = Date.now();
      store.upsert('tasks', task);
    } else {
      const taskId = store.uid('task');
      task = {
        id: taskId,
        title: (screening.filmTitle || screening.eventName || 'Cinema') + ' — Pre-Screening Follow-up',
        description: text + (screening.issuesNoted ? '\n\nIssues noted: ' + screening.issuesNoted.trim() : ''),
        category: 'Cinema & DCP',
        space: screening.screen || 'Screen One',
        priority: screening.outcome === 'Failed' ? 'Urgent' : (screening.outcome === 'Passed with Caveats' ? 'High' : 'Medium'),
        status: 'Pending',
        assignedTechId: screening.testedByUserId || '',
        assignedTechName: screening.testedByUserName || '',
        taggedUserIds: screening.testedByUserId ? [screening.testedByUserId] : [],
        taggedUserNames: screening.testedByUserName ? [screening.testedByUserName] : [],
        reportedBy: auth.displayName(auth.current()) || 'Cinema Tech',
        source: 'dcp_test',
        linkedScreeningId: screening.id,
        linkedEventId: screening.eventId || '',
        filmTitle: screening.filmTitle || screening.eventName || '',
        screen: screening.screen || 'Screen One',
        dueDate: screening.eventDate || '',
        dueTime: screening.eventStartTime || '',
        mediaType: screening.mediaType || '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      store.upsert('tasks', task);
      screening.linkedTaskId = taskId;
    }

    screening.hasFurtherAction = true;
    screening.furtherAction = text;
    screening.updatedAt = new Date().toISOString();
    store.upsert('dcps', screening);

    syncDcpToAdvance(screening);

    if (RMTP.syncSb && RMTP.syncSb.drain) {
      RMTP.syncSb.drain();
    }
    return task;
  }
  /* ---- QC Report & Client Email Generator Engine ---- */
  function generateQcEmail(dcp) {
    const crit = ensureQcCriteria(dcp);
    const film = dcp.filmTitle || dcp.eventName || 'Cinema Screening';
    const client = dcp.clientName || 'Screening Client / Distributor';
    const screen = dcp.screen || 'Screen One';
    const date = dcp.eventDate ? new Date(dcp.eventDate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date TBC';
    const time = dcp.eventStartTime || 'Time TBC';
    const picFmt = dcp.pictureFormat || (dcp.mediaType === 'DCP' ? 'Flat (1.85:1)' : '16:9 Full HD');
    const audFmt = dcp.audioFormat || '5.1 Surround';
    const outcome = dcp.outcome || 'Pending';
    const deadline = dcp.deadlineDate ? new Date(dcp.deadlineDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '48 hours prior to screening';

    // Format text table for email
    const rows = QC_CRITERIA_DEFINITIONS.map(def => {
      const c = crit[def.id] || { status: 'Pending', notes: '' };
      let st = c.status ? c.status.toUpperCase() : 'PENDING';
      if (st === 'CAVEATS') st = 'CAVEATS';
      const padCat = (def.num + '. ' + def.title).padEnd(28, ' ');
      const padStatus = st.padEnd(9, ' ');
      const note = c.notes ? c.notes : (def.passDesc ? 'Tested & verified.' : '-');
      return `${padCat} | ${padStatus} | ${note}`;
    });
    const tableHeader = 'Category                     | Status    | Notes\n-----------------------------+-----------+----------------------------------------------';
    const tableStr = tableHeader + '\n' + rows.join('\n');

    let subject = '';
    let body = '';

    if (outcome === 'Passed') {
      subject = `DCP QC Test Passed \u2014 ${film} \u2014 ${dcp.eventDate || date}`;
      body =
`Dear ${client},

We have completed the Quality Control (QC) testing for your upcoming screening of ${film} in ${screen} at Rich Mix.

We are pleased to confirm that the DCP has PASSED all technical checks and is ready for playback.

Technical Details:
\u2022 Film / Event: ${film}
\u2022 Screening Date & Time: ${date} at ${time}
\u2022 Venue: ${screen}
\u2022 Picture Format: ${picFmt}
\u2022 Audio Format: ${audFmt}
\u2022 Target Media Block: ${dcp.targetHardware || HARDWARE_MEDIA_BLOCKS[screen] || screen}

QC Summary:
${tableStr}

No further action is required from your side. If you have any questions or require any adjustments prior to the screening, please don't hesitate to get in touch.

Best regards,
Rich Mix Technical Team

--
Rich Mix Cultural Foundation
35-47 Bethnal Green Road, London, E1 6LA
richmix.org.uk | Company number: 04293133 | Charity number: 1089163`;
    } else if (outcome === 'Passed with Caveats') {
      subject = `DCP QC Test Passed with Caveats \u2014 ${film} \u2014 Action Required \u2014 ${dcp.eventDate || date}`;
      const actionText = (dcp.furtherAction ? dcp.furtherAction : (dcp.issuesNoted ? dcp.issuesNoted : 'Please review the technician notes listed in the QC summary above.'));
      body =
`Dear ${client},

We have completed the Quality Control (QC) testing for your upcoming screening of ${film} in ${screen} at Rich Mix.

The DCP has PASSED WITH CAVEATS. The content is playable, but our technicians noted issues that you should be aware of prior to the event. Please review the details below.

Technical Details:
\u2022 Film / Event: ${film}
\u2022 Screening Date & Time: ${date} at ${time}
\u2022 Venue: ${screen}
\u2022 Picture Format: ${picFmt}
\u2022 Audio Format: ${audFmt}
\u2022 Target Media Block: ${dcp.targetHardware || HARDWARE_MEDIA_BLOCKS[screen] || screen}

QC Summary:
${tableStr}

Recommended Actions:
\u2022 ${actionText}

Please let us know how you would like to proceed by ${deadline}. If we do not hear from you, we will proceed with playback using the adjustments noted above.

Best regards,
Rich Mix Technical Team

--
Rich Mix Cultural Foundation
35-47 Bethnal Green Road, London, E1 6LA
richmix.org.uk | Company number: 04293133 | Charity number: 1089163`;
    } else if (outcome === 'Failed') {
      subject = `URGENT: DCP QC Test Failed \u2014 ${film} \u2014 Replacement Required \u2014 ${dcp.eventDate || date}`;
      const actionText = (dcp.furtherAction ? dcp.furtherAction : (dcp.issuesNoted ? dcp.issuesNoted : 'A replacement DCP addressing the failures listed above is required.'));
      body =
`Dear ${client},

We have completed the Quality Control (QC) testing for your upcoming screening of ${film} in ${screen} at Rich Mix.

Unfortunately, the DCP has FAILED our technical checks and cannot be screened in its current state.

Technical Details:
\u2022 Film / Event: ${film}
\u2022 Screening Date & Time: ${date} at ${time}
\u2022 Venue: ${screen}
\u2022 Picture Format: ${picFmt}
\u2022 Audio Format: ${audFmt}
\u2022 Target Media Block: ${dcp.targetHardware || HARDWARE_MEDIA_BLOCKS[screen] || screen}

QC Summary:
${tableStr}

Required Actions:
\u2022 ${actionText}

Please arrange for a corrected DCP to be delivered no later than ${deadline} to allow sufficient time for re-ingest and testing.

If you need assistance resolving these issues, please contact the Technical Team immediately.

Best regards,
Rich Mix Technical Team

--
Rich Mix Cultural Foundation
35-47 Bethnal Green Road, London, E1 6LA
richmix.org.uk | Company number: 04293133 | Charity number: 1089163`;
    } else {
      // Pending
      subject = `DCP QC Test In Progress \u2014 ${film} \u2014 ${dcp.eventDate || date}`;
      body =
`Dear ${client},

QC testing for your upcoming screening of ${film} in ${screen} is currently underway.

Technical Details:
\u2022 Film / Event: ${film}
\u2022 Screening Date & Time: ${date} at ${time}
\u2022 Venue: ${screen}
\u2022 Picture Format: ${picFmt}
\u2022 Audio Format: ${audFmt}

Our technicians are currently validating ingestion, KDMs, audio sync, and visual framing against our cinema playback criteria. We will provide a finalized QC sign-off report shortly.

Best regards,
Rich Mix Technical Team

--
Rich Mix Cultural Foundation
35-47 Bethnal Green Road, London, E1 6LA
richmix.org.uk | Company number: 04293133 | Charity number: 1089163`;
    }

    return { subject, body };
  }
  RMTP.generateQcEmail = generateQcEmail;

  /* ---- Open QC Report & Email Modal ---- */
  function openQcReportModal(dcp) {
    if (!dcp) return;
    const crit = ensureQcCriteria(dcp);
    const email = generateQcEmail(dcp);
    const film = dcp.filmTitle || dcp.eventName || 'Cinema Screening';
    const client = dcp.clientName || 'Screening Client / Distributor';
    const screen = dcp.screen || 'Screen One';
    const dateFormatted = dcp.eventDate ? new Date(dcp.eventDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : 'Date TBC';
    const time = dcp.eventStartTime || 'Time TBC';
    const picFmt = dcp.pictureFormat || (dcp.mediaType === 'DCP' ? 'Flat (1.85:1)' : '16:9 Full HD');
    const audFmt = dcp.audioFormat || '5.1 Surround';
    const outcome = dcp.outcome || 'Pending';
    const deadline = dcp.deadlineDate ? new Date(dcp.deadlineDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '48 hours prior to screening';
    const reportRef = dcp.lastReportId || ('QC-RM-' + (dcp.eventDate ? dcp.eventDate.replace(/-/g, '') : '2026') + '-' + (dcp.id ? dcp.id.slice(-4).toUpperCase() : '001'));
    const generatedTimestamp = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const testerName = dcp.testedByUserName || (curUser ? auth.displayName(curUser) : 'Cinema Technician');

    // Persist Report to Supabase backend in reports table
    const reportRecord = {
      id: reportRef,
      type: 'dcp_qc',
      title: 'QC Report: ' + film,
      screeningId: dcp.id,
      eventId: dcp.eventId || '',
      filmTitle: film,
      screen: screen,
      date: dcp.eventDate || '',
      outcome: outcome,
      testerName: testerName,
      clientName: client,
      emailSubject: email.subject,
      emailBody: email.body,
      createdAt: new Date().toISOString()
    };
    store.upsert('reports', reportRecord);
    dcp.lastReportId = reportRef;
    dcp.reportGeneratedAt = new Date().toISOString();
    store.upsert('dcps', dcp);
    if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();

    let outcomeBg = 'bg-slate-100 text-slate-800 border-slate-300';
    let outcomeTitle = 'TESTING IN PROGRESS / PENDING';
    let outcomeDesc = 'Verification checks are ongoing. Final sign-off pending completion.';
    if (outcome === 'Passed') {
      outcomeBg = 'bg-emerald-50 text-emerald-900 border-emerald-300';
      outcomeTitle = 'DCP QC PASSED \u2014 APPROVED FOR PLAYBACK';
      outcomeDesc = 'The DCP has passed all technical requirements and is fully authorized for public screening.';
    } else if (outcome === 'Passed with Caveats') {
      outcomeBg = 'bg-amber-50 text-amber-950 border-amber-300';
      outcomeTitle = 'PASSED WITH CAVEATS \u2014 ACTION / ACKNOWLEDGEMENT REQUIRED';
      outcomeDesc = 'The content is playable, but minor technical offsets or adjustments are required as detailed below.';
    } else if (outcome === 'Failed') {
      outcomeBg = 'bg-rose-50 text-rose-950 border-rose-300';
      outcomeTitle = 'DCP QC FAILED \u2014 REPLACEMENT REQUIRED';
      outcomeDesc = 'Critical technical errors prevent playback. Content must be replaced or re-mastered prior to screening.';
    }

    const modalBody =
      '<div class="space-y-4 max-h-[82vh] overflow-y-auto pr-1">' +
        // Tab Strip & Actions Header
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 rounded-xl bg-panel2/60 border border-line">' +
          '<div class="flex items-center gap-1.5">' +
            '<button type="button" id="tab-btn-pdf" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-accent text-white shadow-2xs flex items-center gap-1.5">' +
              ui.icon('file-text', 'w-3.5 h-3.5') + '<span>PDF Report View</span>' +
            '</button>' +
            '<button type="button" id="tab-btn-email" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-muted hover:text-ink hover:bg-panel/60 flex items-center gap-1.5">' +
              ui.icon('mail', 'w-3.5 h-3.5') + '<span>Client Email Template</span>' +
            '</button>' +
          '</div>' +
          '<div class="flex items-center gap-2 shrink-0 flex-wrap">' +
            '<button type="button" id="btn-edit-checklist-top" class="btn btn-ghost !py-1.5 !px-3 text-xs font-semibold flex items-center gap-1.5 text-accent border border-accent/40 hover:bg-accent/10" title="Open 7-category evaluation editor to modify checklist & sign-off">' +
              ui.icon('check', 'w-3.5 h-3.5') + '<span>Edit Checklist</span>' +
            '</button>' +
            '<button type="button" id="btn-download-pdf" class="btn btn-primary !py-1.5 !px-3 text-xs font-bold flex items-center gap-1.5 shadow-2xs" title="Download High-Resolution Branded PDF Report">' +
              ui.icon('download', 'w-3.5 h-3.5') + '<span>Download PDF</span>' +
            '</button>' +
            '<button type="button" id="btn-print-report" class="btn btn-ghost !py-1.5 !px-3 text-xs font-semibold flex items-center gap-1.5" title="Print Report">' +
              ui.icon('printer', 'w-3.5 h-3.5') + '<span>Print</span>' +
            '</button>' +
            '<button type="button" id="btn-copy-email-top" class="btn btn-ghost !py-1.5 !px-3 text-xs font-semibold flex items-center gap-1.5" title="Copy Client Email to Clipboard">' +
              ui.icon('copy', 'w-3.5 h-3.5') + '<span>Copy Email</span>' +
            '</button>' +
          '</div>' +
        '</div>' +

        // TAB 1: PDF Document View (Rich Mix Brand)
        '<div id="view-tab-pdf" class="block space-y-4">' +
          '<div id="qc-printable-report" class="p-6 sm:p-8 rounded-xl bg-white text-slate-900 shadow-md border border-slate-200 font-sans leading-relaxed text-xs space-y-5 print:p-0 print:border-0 print:shadow-none">' +
            // Header Bar
            '<div class="flex items-start justify-between pb-4 border-b-2 border-slate-900 gap-4">' +
              '<div>' +
                '<div class="flex items-center gap-2">' +
                  '<div class="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-sm tracking-wider font-mono">RM</div>' +
                  '<div>' +
                    '<div class="font-black text-base tracking-tight text-slate-950 font-display">RICH MIX CINEMA</div>' +
                    '<div class="text-[10px] font-mono uppercase tracking-widest text-slate-500 font-semibold">Technical Services &amp; Projection Booth</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="text-right">' +
                '<div class="inline-block px-2.5 py-1 rounded bg-slate-100 text-slate-900 border border-slate-300 font-mono text-[11px] font-bold tracking-wide">REF: ' + reportRef + '</div>' +
                '<div class="text-[10px] text-slate-500 mt-1 font-mono">Generated: ' + generatedTimestamp + '</div>' +
              '</div>' +
            '</div>' +

            // Document Title
            '<div class="text-center py-1">' +
              '<h1 class="text-lg font-black tracking-tight text-slate-950 uppercase font-display">Cinema Quality Control (QC) Sign-Off Report</h1>' +
              '<p class="text-[11px] text-slate-500 mt-0.5">Official Rich Mix technical playback verification standard for DCI-compliant screenings</p>' +
            '</div>' +

            // Overall Outcome Banner
            '<div class="p-3.5 rounded-lg border-2 ' + outcomeBg + ' flex items-center justify-between gap-3">' +
              '<div>' +
                '<div class="font-black text-sm tracking-wide font-display">' + outcomeTitle + '</div>' +
                '<div class="text-[11px] mt-0.5 opacity-90">' + outcomeDesc + '</div>' +
              '</div>' +
              '<div class="text-right shrink-0">' +
                '<span class="px-3 py-1 rounded text-xs font-mono font-black uppercase tracking-wider bg-white/80 shadow-xs border border-current">' + outcome + '</span>' +
              '</div>' +
            '</div>' +

            // Screening Metadata Grid
            '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800">' +
              '<div>' +
                '<div class="text-[9px] font-mono uppercase text-slate-400 font-bold tracking-wider">Film / Screening</div>' +
                '<div class="font-bold text-slate-950 text-xs mt-0.5 break-words">' + ui.esc(film) + '</div>' +
              '</div>' +
              '<div>' +
                '<div class="text-[9px] font-mono uppercase text-slate-400 font-bold tracking-wider">Client / Distributor</div>' +
                '<div class="font-bold text-slate-950 text-xs mt-0.5 break-words">' + ui.esc(client) + '</div>' +
              '</div>' +
              '<div>' +
                '<div class="text-[9px] font-mono uppercase text-slate-400 font-bold tracking-wider">Screening Date &amp; Time</div>' +
                '<div class="font-bold text-slate-950 text-xs mt-0.5">' + ui.esc(dateFormatted) + '<br/><span class="font-mono text-slate-600">' + ui.esc(time) + '</span></div>' +
              '</div>' +
              '<div>' +
                '<div class="text-[9px] font-mono uppercase text-slate-400 font-bold tracking-wider">Venue / Cinema Space</div>' +
                '<div class="font-bold text-slate-950 text-xs mt-0.5">' + ui.esc(screen) + '</div>' +
              '</div>' +
              '<div class="pt-2 border-t border-slate-200/80">' +
                '<div class="text-[9px] font-mono uppercase text-slate-400 font-bold tracking-wider">Picture Aspect Format</div>' +
                '<div class="font-semibold text-slate-900 text-xs mt-0.5">' + ui.esc(picFmt) + '</div>' +
              '</div>' +
              '<div class="pt-2 border-t border-slate-200/80">' +
                '<div class="text-[9px] font-mono uppercase text-slate-400 font-bold tracking-wider">Audio Routing Format</div>' +
                '<div class="font-semibold text-slate-900 text-xs mt-0.5">' + ui.esc(audFmt) + '</div>' +
              '</div>' +
              '<div class="pt-2 border-t border-slate-200/80">' +
                '<div class="text-[9px] font-mono uppercase text-slate-400 font-bold tracking-wider">Media Type</div>' +
                '<div class="font-semibold text-slate-900 text-xs mt-0.5">' + ui.esc(dcp.mediaType || 'DCP') + '</div>' +
              '</div>' +
              '<div class="pt-2 border-t border-slate-200/80">' +
                '<div class="text-[9px] font-mono uppercase text-slate-400 font-bold tracking-wider">Revision Deadline</div>' +
                '<div class="font-semibold text-slate-900 text-xs mt-0.5">' + ui.esc(deadline) + '</div>' +
              '</div>' +
            '</div>' +

            // 7 QC Test Categories Matrix
            '<div>' +
              '<div class="text-[11px] font-black uppercase tracking-wider text-slate-900 mb-2 font-display">Cinema QC Verification Checklist &amp; Evaluation Matrix (7 Categories)</div>' +
              '<table class="w-full text-left text-xs border border-slate-300 rounded overflow-hidden">' +
                '<thead>' +
                  '<tr class="bg-slate-100 text-slate-700 font-mono uppercase text-[9px] tracking-wider border-b border-slate-300">' +
                    '<th class="py-2 px-2.5 w-8 text-center">#</th>' +
                    '<th class="py-2 px-3 w-48">Test Parameter</th>' +
                    '<th class="py-2 px-3">Standard Requirement</th>' +
                    '<th class="py-2 px-3 w-28 text-center">Result</th>' +
                    '<th class="py-2 px-3 w-64">Technician Observations</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody class="divide-y divide-slate-200">' +
                  QC_CRITERIA_DEFINITIONS.map(def => {
                    const c = crit[def.id] || { status: 'Pending', notes: '' };
                    let badge = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-300">PENDING</span>';
                    if (c.status === 'Pass') {
                      badge = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">PASS</span>';
                    } else if (c.status === 'Caveats') {
                      badge = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">CAVEATS</span>';
                    } else if (c.status === 'Fail') {
                      badge = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-100 text-rose-900 border border-rose-300">FAIL</span>';
                    }
                    return (
                      '<tr class="align-top">' +
                        '<td class="py-2 px-2.5 text-center font-mono font-bold text-slate-500 text-[10px]">' + def.num + '</td>' +
                        '<td class="py-2 px-3 font-bold text-slate-900">' + ui.esc(def.title) + '</td>' +
                        '<td class="py-2 px-3 text-slate-600 text-[11px] leading-tight">' + ui.esc(def.requirement) + '</td>' +
                        '<td class="py-2 px-3 text-center">' + badge + '</td>' +
                        '<td class="py-2 px-3 text-slate-800 text-[11px] leading-tight">' +
                          ui.esc(c.notes || (c.status === 'Pass' ? def.passDesc : (c.status === 'Caveats' ? def.caveatsDesc : (c.status === 'Fail' ? def.failDesc : '-')))) +
                        '</td>' +
                      '</tr>'
                    );
                  }).join('') +
                '</tbody>' +
              '</table>' +
            '</div>' +

            // Issues and Required Actions
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
              '<div class="p-3 rounded-lg bg-slate-50 border border-slate-200">' +
                '<div class="text-[10px] font-mono font-bold uppercase text-slate-600 tracking-wider">Technician Issues &amp; Notes</div>' +
                '<div class="text-xs text-slate-800 mt-1 leading-relaxed">' +
                  ui.esc(dcp.issuesNoted || 'No negative technical issues recorded during booth evaluation.') +
                '</div>' +
              '</div>' +
              '<div class="p-3 rounded-lg bg-slate-50 border border-slate-200">' +
                '<div class="text-[10px] font-mono font-bold uppercase text-slate-600 tracking-wider">Required Client Actions &amp; Next Steps</div>' +
                '<div class="text-xs text-slate-800 mt-1 leading-relaxed">' +
                  ui.esc(dcp.furtherAction || (outcome === 'Passed' ? 'No further action required. The screening is authorized for live playback.' : 'Please review and address the technical action points highlighted above.')) +
                '</div>' +
              '</div>' +
            '</div>' +

            // Sign-off Block
            '<div class="pt-3 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px] text-slate-600">' +
              '<div>' +
                '<span class="font-bold text-slate-900">Signed Off By:</span> ' + ui.esc(testerName) +
              '</div>' +
              '<div>' +
                '<span class="font-bold text-slate-900">Hardware Media Block:</span> ' + ui.esc(dcp.targetHardware || HARDWARE_MEDIA_BLOCKS[screen] || screen) +
              '</div>' +
              '<div>' +
                '<span class="font-bold text-slate-900">QC Status:</span> <span class="font-mono font-bold text-slate-900">' + outcome.toUpperCase() + '</span>' +
              '</div>' +
            '</div>' +

            // Rich Mix Cultural Foundation Official Registered Office Footer
            '<div class="pt-4 border-t-2 border-slate-900 text-center text-[10px] text-slate-500 font-mono space-y-0.5">' +
              '<div class="font-bold text-slate-800 tracking-wider uppercase">Rich Mix Cultural Foundation</div>' +
              '<div>35-47 Bethnal Green Road, London, E1 6LA \u00b7 richmix.org.uk</div>' +
              '<div>Registered in England &amp; Wales \u00b7 Company no: 04293133 \u00b7 Charity no: 1089163</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // TAB 2: Email Template View
        '<div id="view-tab-email" class="hidden space-y-4">' +
          '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3">' +
            '<div class="flex items-center justify-between gap-2 flex-wrap">' +
              '<span class="eyebrow text-accent flex items-center gap-1.5">' + ui.icon('mail', 'w-3.5 h-3.5') + 'Client Email Notification (Rich Mix Standard)' + '</span>' +
              '<div class="flex items-center gap-2">' +
                '<button type="button" id="btn-copy-subj" class="btn btn-ghost !py-1 !px-2.5 text-xs font-semibold flex items-center gap-1">' +
                  ui.icon('copy', 'w-3 h-3') + '<span>Copy Subject</span>' +
                '</button>' +
                '<button type="button" id="btn-copy-email-body" class="btn btn-primary !py-1 !px-2.5 text-xs font-bold flex items-center gap-1 shadow-2xs">' +
                  ui.icon('copy', 'w-3 h-3') + '<span>Copy Entire Email</span>' +
                '</button>' +
              '</div>' +
            '</div>' +

            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Email Subject Line</label>' +
              '<input type="text" id="email-subject-field" value="' + ui.esc(email.subject) + '" readonly class="field !text-xs w-full font-mono bg-panel text-ink" />' +
            '</div>' +

            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Email Body (Formatted for Client)</label>' +
              '<textarea id="email-body-field" rows="18" readonly class="field !text-xs w-full font-mono bg-panel text-ink leading-relaxed">' + ui.esc(email.body) + '</textarea>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    const modalFooter =
      '<div class="flex items-center justify-between w-full">' +
        '<div class="text-[11px] text-muted font-mono">' +
          'Report record synced to Supabase backend (`reports` &amp; `dcps`)' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<button type="button" data-close-report class="btn btn-ghost text-xs">Close</button>' +
          '<button type="button" id="btn-download-pdf-footer" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5 shadow-2xs">' +
            ui.icon('download', 'w-4 h-4') + '<span>Download PDF Report</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    const m = ui.modal({
      title: 'DCP Quality Control Report \u2014 ' + film,
      body: modalBody,
      footer: modalFooter,
      maxWidth: 'max-w-4xl'
    });

    // Tab switching
    const tabPdf = m.root.querySelector('#tab-btn-pdf');
    const tabEmail = m.root.querySelector('#tab-btn-email');
    const viewPdf = m.root.querySelector('#view-tab-pdf');
    const viewEmail = m.root.querySelector('#view-tab-email');

    function showTab(t) {
      if (t === 'pdf') {
        tabPdf.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-accent text-white shadow-2xs flex items-center gap-1.5';
        tabEmail.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-muted hover:text-ink hover:bg-panel/60 flex items-center gap-1.5';
        viewPdf.classList.remove('hidden');
        viewPdf.classList.add('block');
        viewEmail.classList.remove('block');
        viewEmail.classList.add('hidden');
      } else {
        tabEmail.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-accent text-white shadow-2xs flex items-center gap-1.5';
        tabPdf.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-muted hover:text-ink hover:bg-panel/60 flex items-center gap-1.5';
        viewEmail.classList.remove('hidden');
        viewEmail.classList.add('block');
        viewPdf.classList.remove('block');
        viewPdf.classList.add('hidden');
      }
    }

    tabPdf.addEventListener('click', () => showTab('pdf'));
    tabEmail.addEventListener('click', () => showTab('email'));

    // Copy subject
    m.root.querySelector('#btn-copy-subj')?.addEventListener('click', () => {
      navigator.clipboard.writeText(email.subject).then(() => {
        ui.toast('Email subject copied to clipboard', 'ok');
      }).catch(() => {
        m.root.querySelector('#email-subject-field')?.select();
        document.execCommand('copy');
        ui.toast('Subject line copied', 'ok');
      });
    });

    // Copy email body
    const copyEmailHandler = () => {
      navigator.clipboard.writeText(email.body).then(() => {
        ui.toast('Client email template copied to clipboard!', 'ok');
      }).catch(() => {
        m.root.querySelector('#email-body-field')?.select();
        document.execCommand('copy');
        ui.toast('Email text copied to clipboard', 'ok');
      });
    };
    m.root.querySelector('#btn-copy-email-top')?.addEventListener('click', copyEmailHandler);
    m.root.querySelector('#btn-copy-email-body')?.addEventListener('click', copyEmailHandler);

    // Download PDF handler
    const downloadPdfHandler = () => {
      showTab('pdf');
      const element = m.root.querySelector('#qc-printable-report');
      if (!element) return;

      const filename = `RichMix_QC_Report_${film.replace(/[^a-zA-Z0-9]/g, '_')}_${dcp.eventDate || 'Date'}.pdf`;

      if (window.html2pdf) {
        ui.toast('Generating PDF report...', 'info');
        const opt = {
          margin: [8, 8, 8, 8],
          filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        window.html2pdf().set(opt).from(element).save().then(() => {
          ui.toast('PDF report downloaded successfully!', 'ok');
        }).catch(err => {
          console.warn('[PDF Download] html2pdf error, triggering system print fallback:', err);
          window.print();
        });
      } else {
        window.print();
      }
    };

    m.root.querySelector('#btn-download-pdf')?.addEventListener('click', downloadPdfHandler);
    m.root.querySelector('#btn-download-pdf-footer')?.addEventListener('click', downloadPdfHandler);
    m.root.querySelector('#btn-print-report')?.addEventListener('click', () => {
      showTab('pdf');
      window.print();
    });

    m.root.querySelector('#btn-edit-checklist-top')?.addEventListener('click', () => {
      m.close();
      openSignoffModal(dcp);
    });

    m.root.querySelector('[data-close-report]')?.addEventListener('click', m.close);
  }
  RMTP.openQcReportModal = openQcReportModal;

  /* ---- Filter State ---- */
  let activeScreenTab = 'all'; // 'all', 'Screen One', 'Screen Two', 'Screen Three'
  let activeOutcomeFilter = 'all'; // 'all', 'Passed', 'Pending', 'Caveats', 'Failed'
  let activeDateFilter = 'upcoming'; // 'upcoming' (default), 'all', 'past', 'cancelled'
  let excludePast = true;
  let searchTerm = '';

  /* ---- Shared Watertight Delete Handler (Tracker-Only Dismissal for Synced Events) ---- */
  async function handleDeleteScreening(dcp, onAfterDelete) {
    if (!dcp) return;
    const isManual = isManualScreeningRecord(dcp);
    const title = dcp.filmTitle || dcp.eventName || 'Screening';
    const message = isManual
      ? ('Permanently delete manual screening \u201c' + title + '\u201d from the Pre-Screening Tracker?')
      : ('Remove \u201c' + title + '\u201d from the Pre-Screening Tracker? The underlying Event Advance will be kept untouched, and you can restore it anytime from Hidden Screenings.');
    const ok = await ui.confirm(message, {
      title: isManual ? 'Delete Manual Screening' : 'Remove from Pre-Screening Tracker',
      danger: true,
      confirmLabel: isManual ? 'Delete' : 'Remove from Tracker'
    });
    if (!ok) return;
    eng.dismissAndRemoveScreening(dcp);
    ui.toast(
      isManual
        ? ('Deleted manual screening \u201c' + title + '\u201d')
        : ('Removed \u201c' + title + '\u201d from tracker (Event Advance kept)'),
      'ok'
    );
    if (typeof onAfterDelete === 'function') {
      onAfterDelete();
    } else {
      renderView();
    }
  }

  /* ---- Restore Hidden Screenings Modal ---- */
  function openRestoreHiddenModal() {
    const items = eng.getDismissedScreenings();
    const bodyHtml = items.length === 0
      ? '<div class="p-6 text-center text-xs text-muted">No screenings are currently hidden from the tracker.</div>'
      : (
        '<div class="space-y-3 max-h-[65vh] overflow-y-auto pr-1">' +
          '<p class="text-xs text-muted leading-relaxed">' +
            'These screenings were removed from the Pre-Screening Tracker while keeping their Event Advance intact. Restore any screening below to bring it back into the tracker.' +
          '</p>' +
          '<div class="divide-y divide-line rounded-xl border border-line bg-panel overflow-hidden">' +
            items.map((it) => {
              const dateStr = it.date ? (ui.formatDate ? ui.formatDate(it.date) : it.date) : 'Date TBC';
              return (
                '<div class="p-3 flex items-center justify-between gap-3 hover:bg-panel2/40 transition-colors">' +
                  '<div class="min-w-0">' +
                    '<div class="font-semibold text-xs text-ink truncate">' + ui.esc(it.title || 'Screening') + '</div>' +
                    '<div class="text-[11px] font-mono text-muted mt-0.5 flex items-center gap-2 flex-wrap">' +
                      '<span>' + ui.esc(dateStr) + (it.startTime ? ' \u00b7 ' + ui.esc(it.startTime) : '') + '</span>' +
                      (it.screen ? '<span class="px-1.5 py-0.2 rounded bg-panel2 border border-line">' + ui.esc(it.screen) + '</span>' : '') +
                      (it.dismissedBy ? '<span>Hidden by ' + ui.esc(it.dismissedBy) + '</span>' : '') +
                    '</div>' +
                  '</div>' +
                  '<button type="button" data-restore-hidden="' + ui.esc(it.key) + '" class="btn btn-ghost !py-1 !px-2.5 text-xs text-accent border border-accent/30 hover:bg-accent/10 shrink-0 font-semibold">' +
                    'Restore' +
                  '</button>' +
                '</div>'
              );
            }).join('') +
          '</div>' +
        '</div>'
      );

    const footerHtml =
      '<div class="flex items-center justify-between gap-2 w-full">' +
        '<div>' +
          (items.length > 1 ? (
            '<button type="button" id="btn-restore-all-hidden" class="btn btn-ghost text-xs text-accent border border-accent/30 hover:bg-accent/10 font-semibold">' +
              'Restore All (' + items.length + ')' +
            '</button>'
          ) : '') +
        '</div>' +
        '<button type="button" data-close-hidden class="btn btn-primary text-xs font-semibold">Done</button>' +
      '</div>';

    const m = ui.modal({
      title: 'Hidden Screenings (' + items.length + ')',
      body: bodyHtml,
      footer: footerHtml,
      maxWidth: 'max-w-xl'
    });

    m.root.querySelectorAll('[data-restore-hidden]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-restore-hidden');
        if (eng.restoreDismissedScreening(key)) {
          ui.toast('Screening restored to Pre-Screening Tracker', 'ok');
          m.close();
          renderView();
          if (eng.getDismissedScreenings().length > 0) {
            openRestoreHiddenModal();
          }
        }
      });
    });

    m.root.querySelector('#btn-restore-all-hidden')?.addEventListener('click', () => {
      const restoredCount = eng.restoreAllDismissedScreenings();
      m.close();
      ui.toast('Restored ' + restoredCount + ' hidden screening' + (restoredCount === 1 ? '' : 's'), 'ok');
      renderView();
    });

    m.root.querySelector('[data-close-hidden]')?.addEventListener('click', m.close);
  }

  function renderView() {
    const dcps = syncAdvancingToDcps();
    const todayIso = getTodayIso();
    const dismissedList = eng.getDismissedScreenings();

    // Build lookup map of active Advancing events for live status/crew display
    const advById = new Map();
    const cancelledEventIds = new Set();
    (store.all('advancing') || []).forEach((e) => {
      if (!e || e.deleted) return;
      advById.set(e.id, e);
      if (isAdvancingEventCancelled(e)) cancelledEventIds.add(e.id);
    });
    const isDcpCancelled = (d) => {
      if (d.isCancelled || d.outcome === 'Cancelled') return true;
      const evIds = getAllEventIdsForDcp(d);
      if (!evIds.length) return false;
      const activeFound = evIds.some((eid) => advById.has(eid) && !cancelledEventIds.has(eid));
      if (activeFound) return false;
      return evIds.every((eid) => cancelledEventIds.has(eid));
    };

    const activeDcps = dcps.filter(d => !isDcpCancelled(d));
    const cancelledCount = dcps.filter(d => isDcpCancelled(d)).length;

    // Calculate KPI metrics & date buckets
    const totalCount = activeDcps.length;
    const upcomingCount = activeDcps.filter(d => !d.eventDate || d.eventDate >= todayIso).length;
    const pastCount = activeDcps.filter(d => d.eventDate && d.eventDate < todayIso).length;
    const passedCount = activeDcps.filter(d => d.outcome === 'Passed').length;
    const pendingCount = activeDcps.filter(d => !d.outcome || d.outcome === 'Pending').length;
    const actionRequiredCount = activeDcps.filter(d => d.hasFurtherAction || d.outcome === 'Failed').length;
    const mediaReadyCount = activeDcps.filter(d => d.mediaReceived && d.kdmCplReceived).length;

    // Filter list
    let filtered = dcps.slice();

    if (activeScreenTab !== 'all') {
      filtered = filtered.filter(d => d.screen === activeScreenTab);
    }

    // Date filtering & past screening exclusion
    if (activeDateFilter === 'cancelled') {
      filtered = filtered.filter(d => isDcpCancelled(d));
    } else if (activeDateFilter === 'all') {
      filtered = filtered.filter(d => !isDcpCancelled(d));
    } else if (activeDateFilter === 'upcoming' || (excludePast && activeDateFilter !== 'all' && activeDateFilter !== 'past')) {
      filtered = filtered.filter(d => !isDcpCancelled(d) && (!d.eventDate || d.eventDate >= todayIso));
    } else if (activeDateFilter === 'past') {
      filtered = filtered.filter(d => !isDcpCancelled(d) && d.eventDate && d.eventDate < todayIso);
    }

    if (activeOutcomeFilter !== 'all') {
      filtered = filtered.filter(d => {
        if (activeOutcomeFilter === 'Caveats') return d.outcome === 'Passed with Caveats';
        if (activeOutcomeFilter === 'Pending') return !d.outcome || d.outcome === 'Pending';
        return d.outcome === activeOutcomeFilter;
      });
    }

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      filtered = filtered.filter(d =>
        (d.filmTitle && d.filmTitle.toLowerCase().includes(q)) ||
        (d.eventName && d.eventName.toLowerCase().includes(q)) ||
        (d.screen && d.screen.toLowerCase().includes(q)) ||
        (d.mediaType && d.mediaType.toLowerCase().includes(q)) ||
        (d.issuesNoted && d.issuesNoted.toLowerCase().includes(q)) ||
        (d.furtherAction && d.furtherAction.toLowerCase().includes(q))
      );
    }

    // Chronological sort: for upcoming, soonest first; for past archive, most recent past first
    filtered.sort((a, b) => {
      const da = (a.eventDate || '') + ' ' + (a.eventStartTime || '00:00');
      const db = (b.eventDate || '') + ' ' + (b.eventStartTime || '00:00');
      if (activeDateFilter === 'past') {
        return db.localeCompare(da);
      }
      if (da && db && da.trim() !== '00:00' && db.trim() !== '00:00') {
        return da.localeCompare(db);
      }
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    el.innerHTML =
      '<div class="space-y-6 w-full max-w-full pb-16">' +
        // ---- Header Bar ----
        '<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-line">' +
          '<div>' +
            '<div class="flex items-center gap-2.5">' +
              '<h1 class="text-2xl font-bold font-display text-ink tracking-tight flex items-center gap-2">' +
                ui.icon('film', 'w-6 h-6 text-accent') +
                '<span>Pre-Screening Tracker</span>' +
              '</h1>' +
              '<span class="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-accent/15 text-accent border border-accent/30">Cinema Booth</span>' +
            '</div>' +
            '<p class="text-xs text-muted mt-1">' +
              'Pre-screening checklist across Screen 1, 2 &amp; 3. Track media receipt, KDMs, playlists, holding slides, A/V lip-sync, issues, and log follow-up tasks.' +
            '</p>' +
          '</div>' +
          '<div class="flex items-center gap-2.5 shrink-0 flex-wrap">' +
            (dismissedList.length > 0 ? (
              '<button id="btn-open-hidden-dcps" class="btn btn-ghost text-xs flex items-center gap-1.5 text-muted hover:text-ink" title="View or restore screenings removed from this tracker">' +
                ui.icon('refresh', 'w-3.5 h-3.5') + '<span>Hidden (' + dismissedList.length + ')</span>' +
              '</button>'
            ) : '') +
            '<button id="btn-sync-dcps" class="btn btn-ghost text-xs flex items-center gap-1.5" title="Re-sync latest screenings from Event Advancing &amp; Artifax">' +
              ui.icon('refresh', 'w-4 h-4') + '<span>Sync Cinema Advances</span>' +
            '</button>' +
            '<button id="btn-add-dcp" class="btn btn-primary text-xs flex items-center gap-1.5 font-semibold shadow-2xs">' +
              ui.icon('plus', 'w-4 h-4') + '<span>Add Manual Screening</span>' +
            '</button>' +
          '</div>' +
        '</div>' +

        // ---- KPI Metrics Strip ----
        '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' +
          '<div class="p-3.5 rounded-xl bg-panel border border-line">' +
            '<div class="text-[11px] font-mono uppercase tracking-wider text-muted">Screenings Ingested</div>' +
            '<div class="text-2xl font-bold font-mono text-ink mt-1 tabular-nums">' + totalCount + '</div>' +
            '<div class="text-[11px] text-muted mt-1">' + upcomingCount + ' upcoming \u00b7 ' + pastCount + ' past</div>' +
          '</div>' +

          '<div class="p-3.5 rounded-xl bg-panel border border-line">' +
            '<div class="text-[11px] font-mono uppercase tracking-wider text-ok">Testing Passed</div>' +
            '<div class="text-2xl font-bold font-mono text-ok mt-1 tabular-nums">' + passedCount + '</div>' +
            '<div class="text-[11px] text-muted mt-1">' + pendingCount + ' pending test check</div>' +
          '</div>' +

          '<div class="p-3.5 rounded-xl bg-panel border border-line">' +
            '<div class="text-[11px] font-mono uppercase tracking-wider text-info">Media &amp; KDMs Ready</div>' +
            '<div class="text-2xl font-bold font-mono text-info mt-1 tabular-nums">' + mediaReadyCount + '</div>' +
            '<div class="text-[11px] text-muted mt-1">Files &amp; keys checked</div>' +
          '</div>' +

          '<div class="p-3.5 rounded-xl bg-panel border ' + (actionRequiredCount ? 'border-amber-500/40 bg-amber-500/5' : 'border-line') + '">' +
            '<div class="text-[11px] font-mono uppercase tracking-wider ' + (actionRequiredCount ? 'text-amber-400 font-bold' : 'text-muted') + '">Follow-up Actions</div>' +
            '<div class="text-2xl font-bold font-mono ' + (actionRequiredCount ? 'text-amber-400' : 'text-ink') + ' mt-1 tabular-nums">' + actionRequiredCount + '</div>' +
            '<div class="text-[11px] text-muted mt-1">' + (actionRequiredCount ? 'Requires action or maintenance task' : 'Zero outstanding actions') + '</div>' +
          '</div>' +
        '</div>' +

        // ---- Segmented Screen Filter Tabs & Queue Controls ----
        '<div class="space-y-2">' +
          '<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-2 bg-panel2/40 border border-line rounded-xl">' +
            '<div class="flex items-center gap-1 overflow-x-auto pb-1 lg:pb-0 scrollbar-hide">' +
              ['all', 'Screen One', 'Screen Two', 'Screen Three'].map(sp => {
                const isActive = activeScreenTab === sp;
                const label = sp === 'all' ? 'All Screens' : sp;
                return (
                  '<button type="button" data-screen-tab="' + sp + '" class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ' +
                    (isActive ? 'bg-panel text-ink shadow-2xs border border-line' : 'text-muted hover:text-ink hover:bg-panel/50') + '">' +
                    ui.esc(label) +
                  '</button>'
                );
              }).join('') +
            '</div>' +

            '<div class="relative flex-1 lg:max-w-xs">' +
              '<span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-muted">' +
                ui.icon('search', 'w-3.5 h-3.5') +
              '</span>' +
              '<input type="text" id="dcp-search-input" value="' + ui.esc(searchTerm) + '" placeholder="Search film, issues, action..." class="field !py-1.5 !pl-8 !text-xs !bg-panel w-full" />' +
              (searchTerm ? '<button id="dcp-search-clear" class="absolute inset-y-0 right-0 pr-2.5 flex items-center text-muted hover:text-ink">' + ui.icon('x', 'w-3.5 h-3.5') + '</button>' : '') +
            '</div>' +
          '</div>' +

          // Date Scope & Queue Exclusion Toolbar
          '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3 py-2 bg-panel2/30 border border-line rounded-xl text-xs">' +
            '<div class="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">' +
              '<span class="text-[11px] font-semibold text-muted uppercase tracking-wider mr-1">Queue:</span>' +
              '<button type="button" data-date-tab="upcoming" class="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ' +
                (activeDateFilter === 'upcoming' ? 'bg-accent/15 text-accent border border-accent/30 font-bold' : 'text-muted hover:text-ink hover:bg-panel/40') + '">' +
                ui.icon('calendar', 'w-3.5 h-3.5') + '<span>Upcoming & Today (' + upcomingCount + ')</span>' +
              '</button>' +
              '<button type="button" data-date-tab="all" class="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ' +
                (activeDateFilter === 'all' ? 'bg-accent/15 text-accent border border-accent/30 font-bold' : 'text-muted hover:text-ink hover:bg-panel/40') + '">' +
                '<span>All Screenings (' + totalCount + ')</span>' +
              '</button>' +
              '<button type="button" data-date-tab="past" class="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors flex items-center gap-1 ' +
                (activeDateFilter === 'past' ? 'bg-accent/15 text-accent border border-accent/30 font-bold' : 'text-muted hover:text-ink hover:bg-panel/40') + '">' +
                ui.icon('clock', 'w-3.5 h-3.5') + '<span>Past Archive (' + pastCount + ')</span>' +
              '</button>' +
              '<button type="button" data-date-tab="cancelled" class="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ' +
                (activeDateFilter === 'cancelled'
                  ? 'bg-danger/25 text-danger border border-danger/50 font-bold shadow-2xs'
                  : (cancelledCount > 0
                      ? 'bg-danger/10 text-danger hover:text-danger hover:bg-danger/20 border border-danger/30'
                      : 'text-muted hover:text-ink hover:bg-panel/40')) + '">' +
                ui.icon('x', 'w-3.5 h-3.5') + '<span>Cancelled (' + cancelledCount + ')</span>' +
              '</button>' +
            '</div>' +

            '<div class="flex items-center gap-2.5 shrink-0 flex-wrap">' +
              '<label class="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-muted hover:text-ink select-none">' +
                '<input type="checkbox" id="chk-exclude-past" class="w-3.5 h-3.5 rounded accent-[var(--accent)]" ' + (excludePast ? 'checked' : '') + ' />' +
                '<span>Exclude Past Screenings</span>' +
              '</label>' +
              '<div class="h-4 w-px bg-line/80 hidden sm:block"></div>' +
              '<div class="flex items-center gap-1.5">' +
                '<select id="filter-outcome" class="field !py-1 !text-xs !bg-panel border-line text-ink font-medium">' +
                  '<option value="all"' + (activeOutcomeFilter === 'all' ? ' selected' : '') + '>All Outcomes</option>' +
                  '<option value="Passed"' + (activeOutcomeFilter === 'Passed' ? ' selected' : '') + '>Passed</option>' +
                  '<option value="Caveats"' + (activeOutcomeFilter === 'Caveats' ? ' selected' : '') + '>Passed w/ Caveats</option>' +
                  '<option value="Pending"' + (activeOutcomeFilter === 'Pending' ? ' selected' : '') + '>Pending</option>' +
                  '<option value="Failed"' + (activeOutcomeFilter === 'Failed' ? ' selected' : '') + '>Failed</option>' +
                '</select>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Past screening informational banner
          (activeDateFilter === 'upcoming' && pastCount > 0 ? (
            '<div class="flex items-center justify-between text-xs px-3.5 py-1.5 rounded-lg bg-panel border border-line text-muted">' +
              '<div class="flex items-center gap-1.5">' +
                ui.icon('clock', 'w-3.5 h-3.5 text-accent') +
                '<span>Showing <strong>' + filtered.length + '</strong> active screening' + (filtered.length === 1 ? '' : 's') + ' \u00b7 <strong>' + pastCount + '</strong> past screening' + (pastCount === 1 ? '' : 's') + ' excluded from today\u2019s queue.</span>' +
              '</div>' +
              '<button type="button" data-date-tab="past" class="text-accent hover:underline font-semibold text-[11px] flex items-center gap-1">' +
                '<span>View Past Archive</span> \u2192' +
              '</button>' +
            '</div>'
          ) : '') +
        '</div>' +

        // ---- Main Screenings Pre-Testing Checklist Table (Desktop & Tablet) ----
        (filtered.length === 0 ? (
          '<div class="p-12 text-center rounded-2xl bg-panel border border-line">' +
            '<div class="w-12 h-12 rounded-xl bg-panel2 flex items-center justify-center mx-auto mb-3 text-muted">' +
              ui.icon('film', 'w-6 h-6') +
            '</div>' +
            '<h3 class="font-display font-semibold text-ink text-base">No Screenings in Selected View</h3>' +
            '<p class="text-xs text-muted max-w-sm mx-auto mt-1">' +
              (searchTerm ? 'No screenings match your search term \u201c' + ui.esc(searchTerm) + '\u201d.' :
               (activeDateFilter === 'upcoming' ? 'No upcoming screenings found. Past screenings may be filtered out.' : 'No screenings in this screen tab.')) +
            '</p>' +
            '<div class="mt-4 flex justify-center gap-2">' +
              '<button id="btn-reset-filters" class="btn btn-ghost text-xs">Reset Filters</button>' +
              '<button id="btn-empty-add-dcp" class="btn btn-primary text-xs">Add Manual Screening</button>' +
            '</div>' +
          '</div>'
        ) : (
          '<div class="space-y-4">' +
            // Table view (Hidden on very small screens, responsive wrapper)
            '<div class="hidden md:block rounded-xl bg-panel border border-line shadow-2xs overflow-hidden">' +
              '<div class="overflow-x-auto w-full">' +
                '<table class="w-full text-left text-xs border-collapse min-w-[1100px]">' +
                  '<thead>' +
                    '<tr class="bg-panel2/70 text-muted font-mono uppercase text-[10px] tracking-wider border-b border-line select-none">' +
                      '<th class="py-2.5 px-3 min-w-[170px]">Media &amp; Advance</th>' +
                      '<th class="py-2.5 px-3 min-w-[200px]">Film &amp; Screening</th>' +
                      '<th class="py-2.5 px-3 min-w-[320px]">QC Report &amp; 7-Point Checklist</th>' +
                      '<th class="py-2.5 px-3 min-w-[200px]">Technician Issues &amp; Notes</th>' +
                      '<th class="py-2.5 px-3 min-w-[140px]">Outcome</th>' +
                      '<th class="py-2.5 px-3 min-w-[170px]">Further Action / Task</th>' +
                      '<th class="py-2.5 px-3 text-right sticky right-0 bg-panel2/90 z-20 w-[200px] min-w-[200px] shadow-[-8px_0_10px_-4px_rgba(0,0,0,0.3)]">Actions</th>' +
                    '</tr>' +
                  '</thead>' +
                  '<tbody class="divide-y divide-line/60 font-sans">' +
                    filtered.map(d => renderScreeningRow(d)).join('') +
                  '</tbody>' +
                '</table>' +
              '</div>' +
            '</div>' +

            // Mobile Card View (< md)
            '<div class="grid grid-cols-1 gap-3.5 md:hidden">' +
              filtered.map(d => renderScreeningMobileCard(d)).join('') +
            '</div>' +
          '</div>'
        )) +
      '</div>';

    attachViewListeners();
  }

  /* ---- Obvious Link Component to Cinema QC Report (Replaces old 6-checkbox checklist) ---- */
  function renderQcReportLinkBlock(dcp) {
    const crit = ensureQcCriteria(dcp);
    const isSigned = isDcpSignedOff(dcp);
    let passCount = 0;
    let caveatsCount = 0;
    let failCount = 0;
    QC_CRITERIA_DEFINITIONS.forEach(def => {
      const st = (crit[def.id] && crit[def.id].status) || 'Pending';
      if (st === 'Pass') passCount++;
      else if (st === 'Caveats') caveatsCount++;
      else if (st === 'Fail') failCount++;
    });

    const categoryBadges = QC_CRITERIA_DEFINITIONS.map(def => {
      const st = (crit[def.id] && crit[def.id].status) || 'Pending';
      let dotColor = 'bg-slate-400';
      let textColor = 'text-muted';
      let bgStyle = 'bg-panel2/70 border-line';
      if (st === 'Pass') {
        dotColor = 'bg-ok';
        textColor = 'text-ok font-bold';
        bgStyle = 'bg-ok/10 border-ok/30';
      } else if (st === 'Caveats') {
        dotColor = 'bg-warning';
        textColor = 'text-warning font-bold';
        bgStyle = 'bg-warning/10 border-warning/30';
      } else if (st === 'Fail') {
        dotColor = 'bg-danger';
        textColor = 'text-danger font-bold';
        bgStyle = 'bg-danger/10 border-danger/30';
      }
      const shortName = def.title.replace(' & Integrity', '').replace(' Validation', '').replace(' Selection', '').replace(' & Ratios', '').replace(' & Sync', '').replace(' & Accessibility', '').replace(' Stability', '');
      return (
        '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ' + bgStyle + ' ' + textColor + '" title="' + ui.esc(def.title) + ': ' + st + '">' +
          '<span class="w-1.5 h-1.5 rounded-full ' + dotColor + ' shrink-0"></span>' +
          '<span>' + def.num + '.' + ui.esc(shortName) + '</span>' +
        '</span>'
      );
    }).join('');

    let statusPill = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-panel2 text-muted border border-line">Pending</span>';
    if (dcp.outcome === 'Passed') {
      statusPill = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-ok/20 text-ok border border-ok/30">' + ui.icon('check', 'w-3 h-3 inline mr-1') + '7/7 Passed</span>';
    } else if (dcp.outcome === 'Passed with Caveats') {
      statusPill = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-warning/20 text-warning border border-warning/30">Caveats (' + caveatsCount + ')</span>';
    } else if (dcp.outcome === 'Failed') {
      statusPill = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-danger/20 text-danger border border-danger/30">' + ui.icon('x', 'w-3 h-3 inline mr-1') + 'Failed (' + failCount + ')</span>';
    } else if (passCount > 0) {
      statusPill = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-accent/20 text-accent border border-accent/30">' + passCount + '/7 Verified</span>';
    }

    const linkTitle = isSigned
      ? 'Signed off \u2014 Click to view official 7-category QC report & client email'
      : 'Screening not signed off \u2014 Click to open edit screen & complete sign-off';
    const linkPrompt = isSigned
      ? 'Open Report &rarr;'
      : 'Edit Screen &rarr;';

    return (
      '<div data-open-report="' + dcp.id + '" class="group/qc cursor-pointer p-3 rounded-xl border border-accent/40 bg-accent/5 hover:bg-accent/15 transition-all shadow-2xs space-y-2 select-none" title="' + ui.esc(linkTitle) + '">' +
        '<div class="flex items-center justify-between gap-2">' +
          '<div class="flex items-center gap-1.5 font-bold text-xs text-ink group-hover/qc:text-accent transition-colors">' +
            ui.icon(isSigned ? 'file-text' : 'edit-3', 'w-4 h-4 text-accent shrink-0') +
            '<span>QC Report &amp; 7-Point Checklist</span>' +
            '<span class="text-accent group-hover/qc:translate-x-0.5 transition-transform">&rarr;</span>' +
          '</div>' +
          statusPill +
        '</div>' +
        '<div class="flex items-center gap-1 flex-wrap pt-0.5">' +
          categoryBadges +
        '</div>' +
        '<div class="text-[10px] text-accent font-semibold flex items-center justify-between pt-1 border-t border-accent/20">' +
          '<span class="text-muted group-hover/qc:text-ink transition-colors">Ingestion, KDM, CPL, Framing, Audio, Subs, Playback</span>' +
          '<span class="underline group-hover/qc:text-white transition-colors">' + linkPrompt + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---- Render Advancing Status + Crew Context Helper ---- */
  function renderAdvancingContextHtml(dcp) {
    const evIds = getAllEventIdsForDcp(dcp);
    const advEv = evIds.map((eid) => store.find('advancing', eid)).find((e) => e && !e.deleted) || null;
    const parts = [];
    if (advEv && advEv.status) {
      const stLower = String(advEv.status).trim().toLowerCase();
      const stCls = stLower === 'confirmed'
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
        : (stLower === 'cancelled' || stLower === 'canceled'
          ? 'bg-danger/15 text-danger border-danger/30'
          : 'bg-amber-500/15 text-amber-400 border-amber-500/30');
      parts.push('<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ' + stCls + '">' + ui.esc(advEv.status) + '</span>');
    } else if (isManualScreeningRecord(dcp)) {
      parts.push('<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border bg-panel2 text-muted border-line">Manual</span>');
    }

    const crewNames = getAssignedCrewSummary(dcp, advEv);
    if (advEv && advEv.noTechNeeded && !crewNames.length) {
      parts.push('<span class="text-[10px] font-mono text-muted">No Tech Required</span>');
    } else if (crewNames.length) {
      parts.push('<span class="text-[10px] text-ink/90 font-medium truncate max-w-[160px]" title="Assigned Crew: ' + ui.esc(crewNames.join(', ')) + '">' + ui.icon('users', 'w-3 h-3 inline mr-0.5 text-muted') + ui.esc(crewNames.join(', ')) + '</span>');
    }

    if (advEv) {
      parts.push('<a href="#/advancing/' + encodeURIComponent(advEv.id) + '" class="inline-flex items-center gap-0.5 text-[10px] font-semibold text-accent hover:underline" onclick="event.stopPropagation()" title="Open full Event Advance sheet">Advance &rarr;</a>');
    }

    return parts.length
      ? '<div class="flex items-center flex-wrap gap-1.5 mt-1">' + parts.join('') + '</div>'
      : '';
  }

  /* ---- Render Desktop Row ---- */
  function renderScreeningRow(dcp) {
    const todayIso = getTodayIso();
    const isPast = dcp.eventDate && dcp.eventDate < todayIso;
    const isSigned = isDcpSignedOff(dcp);
    const formattedDate = dcp.eventDate ? (ui.formatDate ? ui.formatDate(dcp.eventDate) : dcp.eventDate) : 'Date TBC';
    const timeLabel = dcp.eventStartTime
      ? (dcp.eventFinishTime ? (dcp.eventStartTime + '\u2013' + dcp.eventFinishTime) : dcp.eventStartTime)
      : '';

    // Outcome Badge
    let outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-panel2 text-muted border border-line">Pending</span>';
    if (dcp.outcome === 'Passed') {
      outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-ok/15 text-ok border border-ok/30">' + ui.icon('check', 'w-3 h-3') + 'PASSED</span>';
    } else if (dcp.outcome === 'Passed with Caveats') {
      outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-warning/15 text-warning border border-warning/30">CAVEATS</span>';
    } else if (dcp.outcome === 'Failed') {
      outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-danger/15 text-danger border border-danger/30">' + ui.icon('x', 'w-3 h-3') + 'FAILED</span>';
    } else if (dcp.outcome === 'Cancelled') {
      outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-danger/15 text-danger border border-danger/30">CANCELLED</span>';
    }

    // Task display
    let taskHtml = '';
    if (dcp.linkedTaskId) {
      const task = store.find('tasks', dcp.linkedTaskId) || store.find('maintenance', dcp.linkedTaskId);
      const isResolved = task && (task.status === 'Completed' || task.status === 'Resolved');
      taskHtml =
        '<div class="space-y-1">' +
          '<a href="#/tasks" class="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded font-semibold ' +
            (isResolved ? 'bg-ok/15 text-ok border border-ok/30' : 'bg-accent/15 text-accent border border-accent/30 hover:underline') + '" title="View linked task in Jobs & Tasks">' +
            ui.icon('list', 'w-3 h-3') + '<span>Job #' + ui.esc(dcp.linkedTaskId.slice(0, 10)) + (isResolved ? ' (Done)' : ' (Open)') + '</span>' +
          '</a>' +
          (dcp.furtherAction ? '<div class="text-[11px] text-muted truncate max-w-[170px]" title="' + ui.esc(dcp.furtherAction) + '">' + ui.esc(dcp.furtherAction) + '</div>' : '') +
        '</div>';
    } else if (dcp.hasFurtherAction || dcp.furtherAction) {
      taskHtml =
        '<div class="space-y-1">' +
          '<div class="text-[11px] text-amber-300 font-medium truncate max-w-[170px]" title="' + ui.esc(dcp.furtherAction) + '">' +
            ui.esc(dcp.furtherAction) +
          '</div>' +
          '<button type="button" data-log-task="' + dcp.id + '" class="btn btn-ghost !py-0.5 !px-1.5 text-[10px] text-accent flex items-center gap-1 hover:underline">' +
            ui.icon('plus', 'w-3 h-3') + '<span>Add to Jobs List</span>' +
          '</button>' +
        '</div>';
    } else {
      taskHtml =
        '<button type="button" data-add-action="' + dcp.id + '" class="text-[11px] text-muted hover:text-ink flex items-center gap-1 py-1 hover:underline">' +
          ui.icon('plus', 'w-3 h-3') + '<span>+ Follow-up Action</span>' +
        '</button>';
    }

    return (
      '<tr class="hover:bg-panel2/30 transition-colors group ' + (isPast ? 'opacity-85' : '') + '">' +
        // 1. Media Type & Advance Dropdown
        '<td class="py-3 px-3 align-top min-w-[175px] border-b border-line/60">' +
          '<div class="mb-1.5">' +
            '<select data-screening-media="' + dcp.id + '" class="field !py-1 !px-2 !text-xs font-semibold bg-panel border-line text-ink w-full shadow-2xs" title="Screening Media Type (Bidirectional with Event Advance)">' +
              '<option value="">\u2014 Blank \u2014</option>' +
              MEDIA_TYPES.map(m =>
                '<option value="' + m + '"' + (dcp.mediaType === m ? ' selected' : '') + '>' + m + '</option>'
              ).join('') +
            '</select>' +
          '</div>' +
          '<div class="flex items-center gap-1.5 font-mono text-[11px] text-muted flex-wrap">' +
            ui.icon('calendar', 'w-3 h-3 text-muted shrink-0') +
            '<span>' + ui.esc(formattedDate) + '</span>' +
            (timeLabel ? '<span class="text-ink font-semibold">' + ui.esc(timeLabel) + '</span>' : '') +
          '</div>' +
          '<div class="mt-1">' +
            '<span class="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-panel2 text-muted border border-line">' +
              ui.icon('pin', 'w-2.5 h-2.5 text-accent') + ui.esc(dcp.screen || 'Screen One') +
            '</span>' +
          '</div>' +
        '</td>' +

        // 2. Film & Screening Title
        '<td class="py-3 px-3 align-top min-w-[215px] max-w-[300px] border-b border-line/60">' +
          '<div class="font-display font-bold text-ink text-sm group-hover:text-accent transition-colors cursor-pointer" data-open-signoff="' + dcp.id + '" title="Click to open pre-screening sign-off sheet">' +
            ui.esc(dcp.filmTitle || dcp.eventName || 'Screening') +
          '</div>' +
          renderAdvancingContextHtml(dcp) +
          '<div class="text-[11px] text-muted mt-1">' +
            (dcp.testedByUserName ? 'Tested by <span class="text-ink font-medium">' + ui.esc(dcp.testedByUserName) + '</span>' : '<span class="text-muted/80">Untested</span>') +
            (dcp.testDateTime ? ' \u00b7 ' + (/^\d{4}-\d{2}-\d{2}$/.test(String(dcp.testDateTime).trim()) ? ui.formatDate(dcp.testDateTime) : new Date(dcp.testDateTime).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'Europe/London' })) : '') +
          '</div>' +
        '</td>' +

        // 3. Cinema QC Report & 7-Point Checklist Link
        '<td class="py-3 px-3 align-top min-w-[320px] border-b border-line/60">' +
          renderQcReportLinkBlock(dcp) +
        '</td>' +

        // 4. Technician Issues & Notes (Inline text input with auto-save)
        '<td class="py-3 px-3 align-top min-w-[200px] border-b border-line/60">' +
          '<input type="text" data-issues-input="' + dcp.id + '" value="' + ui.esc(dcp.issuesNoted || '') + '" placeholder="Technician issues &amp; notes..." class="field !py-1 !px-2 !text-xs w-full bg-panel text-ink" title="Type technician issues and press Enter or click outside to save" />' +
        '</td>' +

        // 5. Outcome of Testing
        '<td class="py-3 px-3 align-top min-w-[140px] border-b border-line/60">' +
          '<select data-outcome-select="' + dcp.id + '" class="field !py-1 !px-2 !text-xs font-semibold bg-panel border-line text-ink w-full">' +
            ['Pending', 'Passed', 'Passed with Caveats', 'Failed'].map(o =>
              '<option value="' + o + '"' + (dcp.outcome === o ? ' selected' : '') + '>' + o + '</option>'
            ).join('') +
          '</select>' +
          '<div class="mt-1">' + outcomeBadge + '</div>' +
        '</td>' +

        // 6. Further Action / Task
        '<td class="py-3 px-3 align-top min-w-[170px] border-b border-line/60">' +
          taskHtml +
        '</td>' +

        // 7. Actions (Sticky column on right edge so buttons are never cut off)
        '<td class="py-3 px-3 align-middle text-right whitespace-nowrap min-w-[210px] w-[210px] sticky right-0 bg-panel group-hover:bg-[#1a202a] transition-colors z-10 shadow-[-10px_0_12px_-4px_rgba(0,0,0,0.45)] border-b border-l border-line/60">' +
          '<div class="flex items-center justify-end gap-1.5 shrink-0">' +
            '<button type="button" data-open-report="' + dcp.id + '" class="btn btn-ghost !py-1 !px-2 text-xs font-semibold flex items-center gap-1 text-accent hover:bg-accent/10 border border-accent/30 shadow-2xs whitespace-nowrap" title="' + (isSigned ? 'View Finalized PDF QC Report & Client Email' : 'Screening not signed off \u2014 Open Edit Screen') + '">' +
              ui.icon(isSigned ? 'file-text' : 'edit-3', 'w-3.5 h-3.5') + '<span>' + (isSigned ? 'QC Report' : 'Edit QC') + '</span>' +
            '</button>' +
            '<button type="button" data-open-signoff="' + dcp.id + '" class="btn btn-primary !py-1 !px-2 text-xs font-semibold flex items-center gap-1 shadow-2xs whitespace-nowrap" title="Open Full Pre-Screening Sign-off Sheet">' +
              ui.icon('check', 'w-3.5 h-3.5') + '<span>' + (isSigned ? 'Edit' : 'Sign-off') + '</span>' +
            '</button>' +
            '<button type="button" data-delete-dcp="' + dcp.id + '" class="btn btn-danger !p-1.5 !h-7 !w-7 min-h-0 shrink-0 inline-flex items-center justify-center rounded-lg" title="Remove Screening from Tracker">' +
              ui.icon('trash', 'w-3.5 h-3.5') +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>'
    );
  }

  /* ---- Render Mobile Card (< md) ---- */
  function renderScreeningMobileCard(dcp) {
    const todayIso = getTodayIso();
    const isPast = dcp.eventDate && dcp.eventDate < todayIso;
    const isSigned = isDcpSignedOff(dcp);
    const formattedDate = dcp.eventDate ? (ui.formatDate ? ui.formatDate(dcp.eventDate) : dcp.eventDate) : 'Date TBC';
    const timeLabel = dcp.eventStartTime
      ? (dcp.eventFinishTime ? (dcp.eventStartTime + '\u2013' + dcp.eventFinishTime) : dcp.eventStartTime)
      : '';

    let outcomeClass = 'border-line';
    if (dcp.outcome === 'Passed') outcomeClass = 'border-ok/40 bg-ok/5';
    else if (dcp.outcome === 'Passed with Caveats') outcomeClass = 'border-warning/40 bg-warning/5';
    else if (dcp.outcome === 'Failed') outcomeClass = 'border-danger/40 bg-danger/5';

    return (
      '<div class="p-4 rounded-xl bg-panel border ' + outcomeClass + ' shadow-2xs space-y-3.5 ' + (isPast ? 'opacity-85' : '') + '">' +
        '<div class="flex items-center justify-between gap-2 flex-wrap">' +
          '<div class="flex items-center gap-1.5">' +
            '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-panel2 text-ink border border-line">' +
              ui.icon('pin', 'w-3 h-3 text-accent') + ui.esc(dcp.screen || 'Screen One') +
            '</span>' +
            '<span class="inline-flex items-center gap-1 text-xs font-mono text-muted">' +
              ui.icon('calendar', 'w-3 h-3') + ui.esc(formattedDate) +
              (timeLabel ? ' <strong class="text-ink">' + ui.esc(timeLabel) + '</strong>' : '') +
            '</span>' +
          '</div>' +
          '<div class="w-full sm:w-auto">' +
            '<select data-screening-media="' + dcp.id + '" class="field !py-1 !px-2 !text-xs font-semibold bg-panel border-line text-ink w-full sm:w-40" title="Select screening media type">' +
              '<option value="">\u2014 Blank \u2014</option>' +
              MEDIA_TYPES.map(m =>
                '<option value="' + m + '"' + (dcp.mediaType === m ? ' selected' : '') + '>' + m + '</option>'
              ).join('') +
            '</select>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<div class="flex items-center justify-between gap-2 flex-wrap">' +
            '<div class="font-display font-bold text-ink text-base cursor-pointer hover:text-accent" data-open-signoff="' + dcp.id + '">' +
              ui.esc(dcp.filmTitle || dcp.eventName || 'Screening') +
            '</div>' +
          '</div>' +
          renderAdvancingContextHtml(dcp) +
          '<div class="text-xs text-muted mt-1">' +
            (dcp.testedByUserName ? 'Tested by ' + ui.esc(dcp.testedByUserName) : 'Untested') +
          '</div>' +
        '</div>' +

        renderQcReportLinkBlock(dcp) +

        // Technician Issues & Notes input
        '<div>' +
          '<label class="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Technician Issues &amp; Notes</label>' +
          '<input type="text" data-issues-input="' + dcp.id + '" value="' + ui.esc(dcp.issuesNoted || '') + '" placeholder="Technician issues &amp; notes..." class="field !py-1.5 !px-2.5 !text-xs w-full bg-panel text-ink" />' +
        '</div>' +

        // Outcome & Further Action
        '<div class="flex items-center justify-between gap-3 pt-1 border-t border-line/60 flex-wrap">' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs text-muted">Outcome:</span>' +
            '<select data-outcome-select="' + dcp.id + '" class="field !py-1 !px-2 !text-xs font-semibold bg-panel border-line text-ink">' +
              ['Pending', 'Passed', 'Passed with Caveats', 'Failed'].map(o =>
                '<option value="' + o + '"' + (dcp.outcome === o ? ' selected' : '') + '>' + o + '</option>'
              ).join('') +
            '</select>' +
          '</div>' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<button type="button" data-open-report="' + dcp.id + '" class="btn btn-ghost !py-1 !px-2 text-xs font-semibold flex items-center gap-1 text-accent border border-accent/30" title="' + (isSigned ? 'View QC Report & Email' : 'Screening not signed off \u2014 Open Edit Screen') + '">' +
              ui.icon(isSigned ? 'file-text' : 'edit-3', 'w-3.5 h-3.5') + '<span>' + (isSigned ? 'QC Report' : 'Edit QC') + '</span>' +
            '</button>' +
            '<button type="button" data-open-signoff="' + dcp.id + '" class="btn btn-primary !py-1 !px-2.5 text-xs font-semibold flex items-center gap-1">' +
              ui.icon('check', 'w-3.5 h-3.5') + '<span>' + (isSigned ? 'Edit' : 'Sign-off Sheet') + '</span>' +
            '</button>' +
            '<button type="button" data-delete-dcp="' + dcp.id + '" class="btn btn-danger !p-1.5 !h-7 !w-7 inline-flex items-center justify-center rounded-lg" title="Remove Screening from Tracker">' +
              ui.icon('trash', 'w-3.5 h-3.5') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---- Open Full Pre-Screening Sign-off Modal (7-Criteria Standard) ---- */
  function openSignoffModal(existing) {
    const isNew = !existing;
    const item = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: 'dcp-manual-' + store.uid('dcp'),
      eventId: '',
      isManual: true,
      eventName: '',
      filmTitle: '',
      clientName: '',
      pictureFormat: 'Flat (1.85:1)',
      audioFormat: '5.1 Surround',
      deadlineDate: '',
      mediaType: 'DCP',
      eventDate: getTodayIso(),
      eventStartTime: '19:00',
      eventFinishTime: '21:00',
      screen: 'Screen One',
      mediaReceived: false,
      kdmCplReceived: false,
      playlistMade: false,
      tested: false,
      holdingSlidesReady: false,
      subsAudioSync: false,
      issuesNoted: '',
      outcome: 'Pending',
      outcomeManualOverride: false,
      hasFurtherAction: false,
      furtherAction: '',
      linkedTaskId: '',
      testedByUserId: auth.current() ? auth.current().id : '',
      testedByUserName: auth.displayName(auth.current()) || '',
      testDateTime: getNowLocalDateTime(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Ensure 7 QC criteria initialized
    ensureQcCriteria(item);

    const linkedEvIds = getAllEventIdsForDcp(item);
    const linkedAdv = linkedEvIds.map((eid) => store.find('advancing', eid)).find((e) => e && !e.deleted) || null;
    const users = store.all('users');
    const userOptions = users.map(u =>
      '<option value="' + u.id + '"' + (item.testedByUserId === u.id ? ' selected' : '') + '>' + ui.esc(auth.displayName(u)) + ' (' + ui.esc(u.position || u.role) + ')</option>'
    ).join('');

    const modalBody =
      '<div class="space-y-6 text-xs max-h-[75vh] overflow-y-auto pr-1">' +
        // Linked Advancing banner
        (linkedAdv ? (
          '<div class="p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-between gap-2.5 flex-wrap">' +
            '<div class="text-[11px] text-ink">' +
              '<span class="font-bold text-accent">Synced with Event Advancing:</span> ' +
              '<span>' + ui.esc(linkedAdv.name || item.eventName || 'Event') + '</span>' +
              (linkedAdv.status ? ' <span class="font-mono text-muted">(' + ui.esc(linkedAdv.status) + ')</span>' : '') +
            '</div>' +
            '<a href="#/advancing/' + encodeURIComponent(linkedAdv.id) + '" class="text-[11px] font-bold text-accent hover:underline" data-close-before-nav>Open Event Advance &rarr;</a>' +
          '</div>'
        ) : '') +

        // Panel 1: Screening & Technical Specification Setup
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center justify-between">' +
            '<span class="flex items-center gap-1.5">' + ui.icon('film', 'w-3.5 h-3.5') + 'Screening &amp; Technical Specifications</span>' +
            '<span class="text-[11px] font-mono text-muted">Booth &amp; Client Metadata</span>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Film / Screening Title *</label>' +
              '<input type="text" id="m-film-title" value="' + ui.esc(item.filmTitle || item.eventName || '') + '" placeholder="e.g. Past Lives" class="field !text-xs w-full font-semibold text-ink" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Client / Distributor Name</label>' +
              '<input type="text" id="m-client-name" value="' + ui.esc(item.clientName || '') + '" placeholder="e.g. StudioCanal / A24 / Private Booking" class="field !text-xs w-full text-ink" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Screen / Venue' + (linkedAdv ? ' (from Advancing)' : '') + '</label>' +
              '<select id="m-screen" class="field !text-xs w-full font-semibold text-ink" ' + (linkedAdv ? 'disabled title="Screen is synced from Event Advancing"' : '') + '>' +
                ['Screen One', 'Screen Two', 'Screen Three'].map(s =>
                  '<option value="' + s + '"' + (item.screen === s ? ' selected' : '') + '>' + s + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Media Type</label>' +
              '<select id="m-media-type" class="field !text-xs w-full font-semibold text-ink">' +
                '<option value="">\u2014 Blank (TBC) \u2014</option>' +
                MEDIA_TYPES.map(m =>
                  '<option value="' + m + '"' + (item.mediaType === m ? ' selected' : '') + '>' + m + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Picture Format</label>' +
              '<select id="m-picture-format" class="field !text-xs w-full text-ink">' +
                ['Flat (1.85:1)', 'Scope (2.39:1)', '16:9 Full HD', 'Other / Custom'].map(f =>
                  '<option value="' + f + '"' + ((item.pictureFormat || 'Flat (1.85:1)') === f ? ' selected' : '') + '>' + f + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Audio Routing Format</label>' +
              '<select id="m-audio-format" class="field !text-xs w-full text-ink">' +
                ['5.1 Surround', '7.1 Surround', 'Stereo (2.0)', 'Dolby Atmos', 'Other'].map(a =>
                  '<option value="' + a + '"' + ((item.audioFormat || '5.1 Surround') === a ? ' selected' : '') + '>' + a + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-4 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Screening Date</label>' +
              '<input type="date" id="m-date" value="' + ui.esc(item.eventDate || '') + '" class="field !text-xs w-full" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Start Time</label>' +
              '<input type="time" id="m-start-time" value="' + ui.esc(item.eventStartTime || '') + '" class="field !text-xs w-full" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Finish Time</label>' +
              '<input type="time" id="m-finish-time" value="' + ui.esc(item.eventFinishTime || '') + '" class="field !text-xs w-full" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Revision Deadline</label>' +
              '<input type="date" id="m-deadline-date" value="' + ui.esc(item.deadlineDate || '') + '" class="field !text-xs w-full" title="Deadline for client to deliver replacement/re-ingest DCP" />' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Panel 2: Standardized 7-Point Technical QC Evaluation Grid
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="flex items-center justify-between gap-2 flex-wrap">' +
            '<div class="eyebrow text-accent flex items-center gap-1.5">' +
              ui.icon('check', 'w-3.5 h-3.5') + '<span>Rich Mix 7-Parameter QC Verification Criteria</span>' +
            '</div>' +
            '<div class="flex items-center gap-2 flex-wrap">' +
              '<button type="button" id="btn-quick-pass-all" class="btn btn-ghost !py-1 !px-2.5 text-xs text-ok hover:bg-ok/10 border border-ok/30 flex items-center gap-1 font-semibold" title="Mark all 7 criteria as Passed without closing so you can add notes">' +
                ui.icon('check', 'w-3 h-3') + '<span>Mark All 7</span>' +
              '</button>' +
              '<button type="button" data-signoff-all-dcp class="px-3 py-1 rounded-lg text-xs font-bold bg-ok hover:bg-ok/90 text-white shadow-2xs flex items-center gap-1.5 transition-colors" title="Pass all 7 QC checks, stamp technician &amp; time, save, and sync to Event Advancing">' +
                ui.icon('check', 'w-3.5 h-3.5') + '<span>Sign Off All (Pass &amp; Save)</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="space-y-3">' +
            QC_CRITERIA_DEFINITIONS.map(def => {
              const currentCrit = (item.qc_criteria && item.qc_criteria[def.id]) || { status: 'Pending', notes: '' };
              const currentStatus = currentCrit.status || 'Pending';
              return (
                '<div class="p-3.5 rounded-xl bg-panel border border-line space-y-2.5 transition-all" data-criteria-card="' + def.id + '">' +
                  '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">' +
                    '<div class="flex items-start gap-2.5">' +
                      '<span class="w-6 h-6 rounded-md bg-panel2 text-ink font-mono font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 border border-line">' +
                        def.num +
                      '</span>' +
                      '<div>' +
                        '<div class="font-bold text-ink text-xs">' + ui.esc(def.title) + '</div>' +
                        '<div class="text-[11px] text-muted leading-tight mt-0.5">' + ui.esc(def.requirement) + '</div>' +
                      '</div>' +
                    '</div>' +

                    // 3-Way Toggle Buttons: Pass / Caveats / Fail
                    '<div class="flex items-center gap-1 shrink-0 p-1 rounded-lg bg-panel2/60 border border-line" data-crit-btn-group="' + def.id + '">' +
                      '<button type="button" data-crit-btn="Pass" data-crit-id="' + def.id + '" class="px-2.5 py-1 rounded text-xs font-bold transition-all ' +
                        (currentStatus === 'Pass' ? 'bg-ok text-white shadow-2xs' : 'text-muted hover:text-ink hover:bg-panel/60') + '">' +
                        'PASS' +
                      '</button>' +
                      '<button type="button" data-crit-btn="Caveats" data-crit-id="' + def.id + '" class="px-2.5 py-1 rounded text-xs font-bold transition-all ' +
                        (currentStatus === 'Caveats' ? 'bg-warning text-slate-950 shadow-2xs' : 'text-muted hover:text-ink hover:bg-panel/60') + '">' +
                        'CAVEATS' +
                      '</button>' +
                      '<button type="button" data-crit-btn="Fail" data-crit-id="' + def.id + '" class="px-2.5 py-1 rounded text-xs font-bold transition-all ' +
                        (currentStatus === 'Fail' ? 'bg-danger text-white shadow-2xs' : 'text-muted hover:text-ink hover:bg-panel/60') + '">' +
                        'FAIL' +
                      '</button>' +
                    '</div>' +
                  '</div>' +

                  // Notes and Guidance
                  '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-line/50 text-[11px]">' +
                    '<div class="text-muted italic flex items-center gap-1">' +
                      ui.icon('info', 'w-3 h-3 text-muted shrink-0') +
                      '<span>Pass rule: ' + ui.esc(def.passDesc) + '</span>' +
                    '</div>' +
                    '<div>' +
                      '<input type="text" data-crit-notes="' + def.id + '" value="' + ui.esc(currentCrit.notes || '') + '" placeholder="Observations / notes for ' + ui.esc(def.title) + '..." class="field !py-1 !px-2 !text-xs w-full bg-panel2/40 text-ink" />' +
                    '</div>' +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Tested By</label>' +
              '<select id="m-tester" class="field !text-xs w-full">' +
                '<option value="">Select Technician...</option>' +
                userOptions +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Test Date &amp; Time</label>' +
              '<input type="datetime-local" id="m-test-date" value="' + ui.esc(item.testDateTime ? item.testDateTime.slice(0, 16) : '') + '" class="field !text-xs w-full" />' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Panel 3: Live Outcome Banner & Override Option
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="flex items-center justify-between gap-2 flex-wrap">' +
            '<div class="eyebrow text-accent flex items-center gap-1.5">' +
              ui.icon('check', 'w-3.5 h-3.5') + '<span>Overall QC Outcome &amp; Sign-off</span>' +
            '</div>' +
            '<label class="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-muted hover:text-ink select-none">' +
              '<input type="checkbox" id="chk-outcome-override" class="w-3.5 h-3.5 rounded accent-[var(--accent)]" ' + (item.outcomeManualOverride ? 'checked' : '') + ' />' +
              '<span>Manual Outcome Override</span>' +
            '</label>' +
          '</div>' +

          // Live Status Display
          '<div id="modal-outcome-banner" class="p-3.5 rounded-xl border flex items-center justify-between gap-3 bg-panel border-line">' +
            '<div class="flex items-center gap-2.5">' +
              '<span id="modal-outcome-icon" class="w-8 h-8 rounded-lg bg-panel2 flex items-center justify-center font-bold text-ink shrink-0">' +
                ui.icon('check', 'w-4 h-4') +
              '</span>' +
              '<div>' +
                '<div class="text-xs font-bold text-ink" id="modal-outcome-title">Outcome: ' + (item.outcome || 'Pending') + '</div>' +
                '<div class="text-[11px] text-muted" id="modal-outcome-desc">Auto-calculated from 7-point evaluation criteria.</div>' +
              '</div>' +
            '</div>' +
            '<div id="modal-outcome-badge">' +
              '<span class="px-2.5 py-1 rounded text-xs font-mono font-bold bg-panel2 text-muted border border-line">' + (item.outcome || 'Pending').toUpperCase() + '</span>' +
            '</div>' +
          '</div>' +

          // Outcome button strip
          '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">' +
            ['Passed', 'Passed with Caveats', 'Failed', 'Pending'].map(out => {
              const isSel = (item.outcome === out) || (!item.outcome && out === 'Pending');
              let borderClass = isSel ? 'border-accent bg-accent/15 text-accent font-bold ring-1 ring-accent' : 'border-line bg-panel text-muted hover:text-ink';
              if (isSel && out === 'Passed') borderClass = 'border-ok bg-ok/15 text-ok font-bold ring-1 ring-ok';
              if (isSel && out === 'Failed') borderClass = 'border-danger bg-danger/15 text-danger font-bold ring-1 ring-danger';
              if (isSel && out === 'Passed with Caveats') borderClass = 'border-warning bg-warning/15 text-warning font-bold ring-1 ring-warning';
              return (
                '<button type="button" data-outcome-btn="' + out + '" class="p-2.5 rounded-lg border text-xs text-center transition-all ' + borderClass + '">' +
                  '<div class="font-semibold">' + out + '</div>' +
                '</button>'
              );
            }).join('') +
          '</div>' +
          '<input type="hidden" id="m-outcome-val" value="' + ui.esc(item.outcome || 'Pending') + '" />' +
          '<div class="text-[10px] text-muted" id="override-hint">' +
            (item.outcomeManualOverride ? 'Manual override is ACTIVE: Outcome is locked to your selection above.' : 'Auto-calculate is ACTIVE: Failing any criteria marks overall Failed; Caveats marks Passed with Caveats.') +
          '</div>' +
        '</div>' +

        // Panel 4: Technician Issues & Notes
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center justify-between">' +
            '<span class="flex items-center gap-1.5">' + ui.icon('tool', 'w-3.5 h-3.5') + '<span>Technician Issues &amp; Notes</span></span>' +
            '<span class="text-[11px] font-mono text-muted">Questionnaire Text Input</span>' +
          '</div>' +
          '<div>' +
            '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Technician Issues &amp; Notes</label>' +
            '<textarea id="m-issues" rows="3" placeholder="Enter technician issues, booth observations, aspect ratio framing quirks, sound level offsets, audio sync lag, or distributor notes..." class="field !text-xs w-full leading-relaxed text-ink">' + ui.esc(item.issuesNoted || '') + '</textarea>' +
            '<div class="text-[10px] text-muted mt-1">Manual technician input. This populates the QC Report and is sent in client notification emails (completely decoupled from Artifax event descriptions).</div>' +
          '</div>' +
        '</div>' +

        // Panel 5: Any further action? (Creates a task with a follow up action)
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="flex items-center justify-between">' +
            '<div class="eyebrow text-accent flex items-center gap-1.5">' +
              ui.icon('list', 'w-3.5 h-3.5') + '<span>Any Further Action? (Creates a Task in the Jobs List)</span>' +
            '</div>' +
            (item.linkedTaskId ? (
              '<a href="#/tasks" class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-accent/15 text-accent border border-accent/30 flex items-center gap-1 hover:underline" onclick="event.stopPropagation()">' +
                ui.icon('list', 'w-3 h-3') + 'View in Jobs List \u2192' +
              '</a>'
            ) : '') +
          '</div>' +

          '<label class="flex items-center gap-2 cursor-pointer">' +
            '<input type="checkbox" id="chk-m-further-action" class="w-4 h-4 rounded accent-[var(--accent)]" ' + (item.hasFurtherAction || item.furtherAction ? 'checked' : '') + ' />' +
            '<span class="font-semibold text-ink text-xs">Yes, further action required before screening</span>' +
          '</label>' +

          '<div id="further-action-fields" class="' + (item.hasFurtherAction || item.furtherAction ? '' : 'hidden') + ' space-y-2 pt-1">' +
            '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider">Required Follow-up Action *</label>' +
            '<textarea id="m-further-action" rows="2" placeholder="e.g. Request distributor re-send KDM for Screen Two; Ingest supplemental subtitle pack; Calibrate optical port..." class="field !text-xs w-full">' + ui.esc(item.furtherAction || '') + '</textarea>' +
            '<div class="p-2.5 rounded-lg bg-panel border border-line text-[11px] text-muted flex items-start gap-2">' +
              ui.icon('list', 'w-4 h-4 text-accent shrink-0 mt-0.5') +
              '<span>Saving will automatically create an <strong>Assignable Task in the Jobs List</strong> linked directly to this screening.</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    const modalFooter =
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">' +
        '<div>' +
          (existing ? (
            '<button type="button" id="btn-del-modal-dcp" class="btn btn-danger text-xs flex items-center gap-1.5">' +
              ui.icon('trash', 'w-4 h-4') + '<span>Remove</span>' +
            '</button>'
          ) : '') +
        '</div>' +
        '<div class="flex items-center gap-2 flex-wrap justify-end">' +
          '<button type="button" id="btn-modal-open-report" class="btn btn-ghost text-xs text-accent hover:bg-accent/10 border border-accent/40 font-bold flex items-center gap-1.5 shadow-2xs" title="Generate QC Report & Client Email">' +
            ui.icon('file-text', 'w-4 h-4') + '<span>QC Report &amp; Email</span>' +
          '</button>' +
          '<button type="button" data-cancel class="btn btn-ghost text-xs">Cancel</button>' +
          '<button type="button" id="btn-signoff-all-dcp" data-signoff-all-dcp class="px-3.5 py-2 rounded-lg text-xs font-bold bg-ok hover:bg-ok/90 text-white flex items-center gap-1.5 shadow-2xs transition-colors" title="Pass all 7 QC checks, stamp technician &amp; time, save, and sync to Event Advancing">' +
            ui.icon('check', 'w-4 h-4') + '<span>Sign Off All</span>' +
          '</button>' +
          '<button type="button" id="btn-save-dcp" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5 shadow-2xs">' +
            ui.icon('check', 'w-4 h-4') + '<span>' + (isNew ? 'Create Screening' : 'Save Sign-off') + '</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    const m = ui.modal({
      title: isNew ? 'Add Manual Screening' : ((item.filmTitle || 'Screening') + ' \u2014 Cinema QC Sign-Off'),
      body: modalBody,
      footer: modalFooter,
      maxWidth: 'max-w-3xl'
    });

    // Helper to refresh live outcome UI
    function refreshOutcomeBanner(outcomeVal) {
      const banner = m.root.querySelector('#modal-outcome-banner');
      const title = m.root.querySelector('#modal-outcome-title');
      const badge = m.root.querySelector('#modal-outcome-badge');
      if (!banner || !title || !badge) return;

      m.root.querySelector('#m-outcome-val').value = outcomeVal;

      if (outcomeVal === 'Passed') {
        banner.className = 'p-3.5 rounded-xl border flex items-center justify-between gap-3 bg-ok/10 border-ok/40 text-ok';
        title.innerHTML = 'Outcome: PASSED (All Criteria Verified)';
        badge.innerHTML = '<span class="px-2.5 py-1 rounded text-xs font-mono font-bold bg-ok text-white">' + ui.icon('check', 'w-3 h-3 inline mr-1') + 'PASSED</span>';
      } else if (outcomeVal === 'Passed with Caveats') {
        banner.className = 'p-3.5 rounded-xl border flex items-center justify-between gap-3 bg-warning/10 border-warning/40 text-warning';
        title.innerHTML = 'Outcome: PASSED WITH CAVEATS (Technical Adjustments Noted)';
        badge.innerHTML = '<span class="px-2.5 py-1 rounded text-xs font-mono font-bold bg-warning text-slate-950">CAVEATS</span>';
      } else if (outcomeVal === 'Failed') {
        banner.className = 'p-3.5 rounded-xl border flex items-center justify-between gap-3 bg-danger/10 border-danger/40 text-danger';
        title.innerHTML = 'Outcome: FAILED (Critical Issues Require Replacement)';
        badge.innerHTML = '<span class="px-2.5 py-1 rounded text-xs font-mono font-bold bg-danger text-white">' + ui.icon('x', 'w-3 h-3 inline mr-1') + 'FAILED</span>';
      } else {
        banner.className = 'p-3.5 rounded-xl border flex items-center justify-between gap-3 bg-panel border-line text-muted';
        title.innerHTML = 'Outcome: PENDING';
        badge.innerHTML = '<span class="px-2.5 py-1 rounded text-xs font-mono font-bold bg-panel2 text-muted border border-line">PENDING</span>';
      }

      m.root.querySelectorAll('[data-outcome-btn]').forEach(btn => {
        const out = btn.getAttribute('data-outcome-btn');
        const isSel = (out === outcomeVal);
        let borderClass = isSel ? 'border-accent bg-accent/15 text-accent font-bold ring-1 ring-accent' : 'border-line bg-panel text-muted hover:text-ink';
        if (isSel && out === 'Passed') borderClass = 'border-ok bg-ok/15 text-ok font-bold ring-1 ring-ok';
        if (isSel && out === 'Failed') borderClass = 'border-danger bg-danger/15 text-danger font-bold ring-1 ring-danger';
        if (isSel && out === 'Passed with Caveats') borderClass = 'border-warning bg-warning/15 text-warning font-bold ring-1 ring-warning';
        btn.className = 'p-2.5 rounded-lg border text-xs text-center transition-all ' + borderClass;
      });
    }

    function reevaluateOutcomeFromCriteria() {
      const isOverride = m.root.querySelector('#chk-outcome-override')?.checked;
      if (isOverride) return;

      const criteriaState = {};
      QC_CRITERIA_DEFINITIONS.forEach(def => {
        const card = m.root.querySelector('[data-criteria-card="' + def.id + '"]');
        const activeBtn = card ? card.querySelector('[data-crit-btn-group="' + def.id + '"] .bg-ok, [data-crit-btn-group="' + def.id + '"] .bg-warning, [data-crit-btn-group="' + def.id + '"] .bg-danger') : null;
        let st = 'Pending';
        if (activeBtn) {
          st = activeBtn.getAttribute('data-crit-btn') || 'Pending';
        }
        criteriaState[def.id] = { status: st };
      });

      const autoOutcome = calculateOverallQcOutcome(criteriaState);
      refreshOutcomeBanner(autoOutcome);
    }

    // Initialize live outcome banner styling on open
    refreshOutcomeBanner(item.outcome || 'Pending');

    // Criteria buttons click handlers
    m.root.querySelectorAll('[data-crit-btn]').forEach(b => {
      b.addEventListener('click', () => {
        const critId = b.getAttribute('data-crit-id');
        const status = b.getAttribute('data-crit-btn');
        const group = m.root.querySelector('[data-crit-btn-group="' + critId + '"]');
        if (!group) return;

        group.querySelectorAll('[data-crit-btn]').forEach(btn => {
          btn.className = 'px-2.5 py-1 rounded text-xs font-bold transition-all text-muted hover:text-ink hover:bg-panel/60';
        });

        if (status === 'Pass') b.className = 'px-2.5 py-1 rounded text-xs font-bold transition-all bg-ok text-white shadow-2xs';
        else if (status === 'Caveats') b.className = 'px-2.5 py-1 rounded text-xs font-bold transition-all bg-warning text-slate-950 shadow-2xs';
        else if (status === 'Fail') b.className = 'px-2.5 py-1 rounded text-xs font-bold transition-all bg-danger text-white shadow-2xs';

        reevaluateOutcomeFromCriteria();
      });
    });

    // Checkbox override change handler
    const chkOverride = m.root.querySelector('#chk-outcome-override');
    const overrideHint = m.root.querySelector('#override-hint');
    if (chkOverride) {
      chkOverride.addEventListener('change', () => {
        if (chkOverride.checked) {
          overrideHint.textContent = 'Manual override is ACTIVE: Outcome is locked to your selection.';
        } else {
          overrideHint.textContent = 'Auto-calculate is ACTIVE: Failing any criteria marks overall Failed; Caveats marks Passed with Caveats.';
          reevaluateOutcomeFromCriteria();
        }
      });
    }

    // Manual Outcome buttons click handlers
    m.root.querySelectorAll('[data-outcome-btn]').forEach(b => {
      b.addEventListener('click', () => {
        const out = b.getAttribute('data-outcome-btn');
        if (chkOverride && !chkOverride.checked) {
          chkOverride.checked = true;
          overrideHint.textContent = 'Manual override is ACTIVE: Outcome is locked to your selection.';
        }
        refreshOutcomeBanner(out);
      });
    });

    function markAllSevenPassedInForm() {
      QC_CRITERIA_DEFINITIONS.forEach(def => {
        const group = m.root.querySelector('[data-crit-btn-group="' + def.id + '"]');
        if (group) {
          group.querySelectorAll('[data-crit-btn]').forEach(btn => {
            btn.className = 'px-2.5 py-1 rounded text-xs font-bold transition-all text-muted hover:text-ink hover:bg-panel/60';
          });
          const passBtn = group.querySelector('[data-crit-btn="Pass"]');
          if (passBtn) passBtn.className = 'px-2.5 py-1 rounded text-xs font-bold transition-all bg-ok text-white shadow-2xs';
        }
      });
      if (chkOverride) {
        chkOverride.checked = false;
        if (overrideHint) overrideHint.textContent = 'Auto-calculate is ACTIVE: Failing any criteria marks overall Failed; Caveats marks Passed with Caveats.';
      }
      refreshOutcomeBanner('Passed');
      const testerSel = m.root.querySelector('#m-tester');
      if (testerSel && !testerSel.value && auth.current()) {
        testerSel.value = auth.current().id;
      }
      const dateInput = m.root.querySelector('#m-test-date');
      if (dateInput && !dateInput.value) {
        dateInput.value = getNowLocalDateTime();
      }
    }

    // Quick Mark All 7 (without closing, in case tech wants to add notes first)
    const btnQuickPass = m.root.querySelector('#btn-quick-pass-all');
    if (btnQuickPass) {
      btnQuickPass.addEventListener('click', () => {
        markAllSevenPassedInForm();
        ui.toast('Marked all 7 QC criteria as PASSED', 'ok');
      });
    }

    // Close modal cleanly if clicking Open Event Advance link
    m.root.querySelector('[data-close-before-nav]')?.addEventListener('click', () => {
      m.close();
    });

    // Toggle further action fields
    const chkAction = m.root.querySelector('#chk-m-further-action');
    const actionFields = m.root.querySelector('#further-action-fields');
    if (chkAction && actionFields) {
      chkAction.addEventListener('change', () => {
        if (chkAction.checked) {
          actionFields.classList.remove('hidden');
          m.root.querySelector('#m-further-action')?.focus();
        } else {
          actionFields.classList.add('hidden');
        }
      });
    }

    // Gather modal form data helper
    function gatherModalData() {
      const titleVal = m.root.querySelector('#m-film-title')?.value.trim();
      if (!titleVal) {
        ui.toast('Screening Title is required', 'danger');
        m.root.querySelector('#m-film-title')?.focus();
        return null;
      }

      const testerId = m.root.querySelector('#m-tester')?.value || '';
      const testerUser = testerId ? store.find('users', testerId) : null;
      const furtherActionReq = m.root.querySelector('#chk-m-further-action')?.checked || false;
      const furtherActionText = m.root.querySelector('#m-further-action')?.value.trim() || '';

      item.filmTitle = titleVal;
      if (!linkedAdv) item.eventName = titleVal;
      item.clientName = m.root.querySelector('#m-client-name')?.value.trim() || '';
      if (!linkedAdv) {
        item.screen = m.root.querySelector('#m-screen')?.value || 'Screen One';
        item.isManual = true;
      }
      item.targetHardware = HARDWARE_MEDIA_BLOCKS[item.screen] || (item.screen + ' Media Block');
      item.mediaType = m.root.querySelector('#m-media-type')?.value || '';
      item.pictureFormat = m.root.querySelector('#m-picture-format')?.value || 'Flat (1.85:1)';
      item.audioFormat = m.root.querySelector('#m-audio-format')?.value || '5.1 Surround';
      item.deadlineDate = m.root.querySelector('#m-deadline-date')?.value || '';
      item.eventDate = m.root.querySelector('#m-date')?.value || '';
      item.eventStartTime = m.root.querySelector('#m-start-time')?.value || '';
      item.eventFinishTime = m.root.querySelector('#m-finish-time')?.value || '';

      // Collect 7 criteria statuses and notes
      item.qc_criteria = {};
      QC_CRITERIA_DEFINITIONS.forEach(def => {
        const group = m.root.querySelector('[data-crit-btn-group="' + def.id + '"]');
        const activeBtn = group ? group.querySelector('.bg-ok, .bg-warning, .bg-danger') : null;
        const st = activeBtn ? activeBtn.getAttribute('data-crit-btn') : 'Pending';
        const notes = m.root.querySelector('[data-crit-notes="' + def.id + '"]')?.value.trim() || '';
        item.qc_criteria[def.id] = { status: st, notes: notes };
      });

      // Synchronize backward-compatible booleans
      item.mediaReceived = (item.qc_criteria.ingestion?.status === 'Pass');
      item.kdmCplReceived = (item.qc_criteria.kdm?.status === 'Pass' && item.qc_criteria.cpl?.status === 'Pass');
      item.playlistMade = (item.qc_criteria.cpl?.status === 'Pass');
      item.tested = (item.qc_criteria.playback?.status === 'Pass' || item.qc_criteria.playback?.status === 'Caveats');
      item.subsAudioSync = (item.qc_criteria.audio?.status === 'Pass' && item.qc_criteria.subtitles?.status === 'Pass');

      item.issuesNoted = m.root.querySelector('#m-issues')?.value.trim() || '';
      item.outcomeManualOverride = !!m.root.querySelector('#chk-outcome-override')?.checked;
      item.outcome = m.root.querySelector('#m-outcome-val')?.value || 'Pending';
      if (item.outcome === 'Passed') {
        item.tested = true;
      }

      item.testedByUserId = testerId;
      item.testedByUserName = testerUser ? auth.displayName(testerUser) : '';
      item.testDateTime = m.root.querySelector('#m-test-date')?.value || '';
      item.updatedAt = new Date().toISOString();

      if (furtherActionReq && furtherActionText) {
        item.hasFurtherAction = true;
        item.furtherAction = furtherActionText;
      } else {
        item.hasFurtherAction = false;
        item.furtherAction = '';
      }

      return item;
    }

    function persistAndCloseModal(data, customToast) {
      if (data.hasFurtherAction && data.furtherAction) {
        createOrUpdateFollowUpTask(data, data.furtherAction);
        ui.toast(customToast || 'Screening saved and Follow-up Task created in Jobs List!', 'ok');
      } else {
        store.upsert('dcps', data);
        syncDcpToAdvance(data);
        if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
        ui.toast(customToast || 'Pre-screening QC sign-off saved', 'ok');
      }
      m.close();
      renderView();
    }

    // One-Click "Sign Off All" (Pass all 7 checks, stamp tester + local time, save, sync & close)
    function performSignOffAll() {
      markAllSevenPassedInForm();
      const data = gatherModalData();
      if (!data) return;
      data.outcome = 'Passed';
      data.outcomeManualOverride = false;
      data.isCancelled = false;
      data.mediaReceived = true;
      data.kdmCplReceived = true;
      data.playlistMade = true;
      data.tested = true;
      data.subsAudioSync = true;
      persistAndCloseModal(data, 'All 7 QC checks signed off as PASSED and synced');
    }

    m.root.querySelectorAll('[data-signoff-all-dcp]').forEach((btn) => {
      btn.addEventListener('click', performSignOffAll);
    });

    // Save button
    const btnSave = m.root.querySelector('#btn-save-dcp');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        const data = gatherModalData();
        if (!data) return;
        persistAndCloseModal(data);
      });
    }

    // Direct "Generate QC Report & Email" button
    const btnGenReport = m.root.querySelector('#btn-modal-open-report');
    if (btnGenReport) {
      btnGenReport.addEventListener('click', () => {
        const data = gatherModalData();
        if (!data) return;

        store.upsert('dcps', data);
        syncDcpToAdvance(data);
        if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();

        m.close();
        renderView();
        setTimeout(() => openQcReportModal(data), 150);
      });
    }

    // Delete / Remove button inside modal (watertight tracker-only dismissal)
    const btnDel = m.root.querySelector('#btn-del-modal-dcp');
    if (btnDel) {
      btnDel.addEventListener('click', () => {
        handleDeleteScreening(item, () => {
          m.close();
          renderView();
        });
      });
    }

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
  }

  /* ---- Attach Event Listeners to View ---- */
  function attachViewListeners() {
    // Screen tabs
    el.querySelectorAll('[data-screen-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeScreenTab = btn.getAttribute('data-screen-tab');
        renderView();
      });
    });

    // Date queue tabs
    el.querySelectorAll('[data-date-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeDateFilter = btn.getAttribute('data-date-tab');
        if (activeDateFilter === 'all' || activeDateFilter === 'past' || activeDateFilter === 'cancelled') {
          excludePast = false;
        } else {
          excludePast = true;
        }
        renderView();
      });
    });

    // Open Hidden / Restore modal
    el.querySelector('#btn-open-hidden-dcps')?.addEventListener('click', () => {
      openRestoreHiddenModal();
    });

    // Exclude past checkbox
    const chkPast = el.querySelector('#chk-exclude-past');
    if (chkPast) {
      chkPast.addEventListener('change', () => {
        excludePast = chkPast.checked;
        if (excludePast && activeDateFilter === 'past') {
          activeDateFilter = 'upcoming';
        }
        renderView();
      });
    }

    // Outcome filter
    const selOutcome = el.querySelector('#filter-outcome');
    if (selOutcome) {
      selOutcome.addEventListener('change', () => {
        activeOutcomeFilter = selOutcome.value;
        renderView();
      });
    }

    // Search bar
    const searchInput = el.querySelector('#dcp-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        clearTimeout(RMTP._dcpSearchTimeout);
        RMTP._dcpSearchTimeout = setTimeout(() => renderView(), 200);
      });
    }

    const searchClr = el.querySelector('#dcp-search-clear');
    if (searchClr) {
      searchClr.addEventListener('click', () => {
        searchTerm = '';
        renderView();
      });
    }

    const btnReset = el.querySelector('#btn-reset-filters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        activeScreenTab = 'all';
        activeOutcomeFilter = 'all';
        activeDateFilter = 'upcoming';
        excludePast = true;
        searchTerm = '';
        renderView();
      });
    }

    // Sync button (Hydrate dismissals -> Pull latest Supabase advancing/dcps/bookings -> Artifax -> reconcile)
    const btnSync = el.querySelector('#btn-sync-dcps');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        btnSync.disabled = true;
        const originalContent = btnSync.innerHTML;
        btnSync.innerHTML = ui.icon('refresh', 'w-4 h-4 animate-spin') + '<span>Syncing Advances...</span>';
        try {
          await eng.hydrateDismissalsFromDb();
          if (RMTP.syncSb && RMTP.syncSb.pullCollection) {
            await Promise.all([
              RMTP.syncSb.pullCollection('advancing'),
              RMTP.syncSb.pullCollection('dcps'),
              RMTP.syncSb.pullCollection('bookings')
            ]);
          }
          if (RMTP.syncArtifax) {
            await RMTP.syncArtifax(true);
          }
        } catch (err) {
          console.warn('[Pre-Screening] Sync error:', err);
        }
        syncAdvancingToDcps();
        ui.toast('Synchronized cinema advances with Pre-Screening Tracker', 'ok');
        btnSync.disabled = false;
        btnSync.innerHTML = originalContent;
        renderView();
      });
    }

    // Add manual screening button
    const btnAdd = el.querySelector('#btn-add-dcp');
    if (btnAdd) btnAdd.addEventListener('click', () => openSignoffModal());

    const btnEmptyAdd = el.querySelector('#btn-empty-add-dcp');
    if (btnEmptyAdd) btnEmptyAdd.addEventListener('click', () => openSignoffModal());

    // Inline Media Type Selector change
    el.querySelectorAll('[data-screening-media]').forEach(sel => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-screening-media');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        dcp.mediaType = sel.value;
        dcp.updatedAt = new Date().toISOString();
        store.upsert('dcps', dcp);
        syncDcpToAdvance(dcp);
        ui.toast('Updated media type to \u201c' + (sel.value || 'Blank') + '\u201d', 'ok');
      });
    });

    // Inline Issues Noted Input (auto-save on change / blur)
    el.querySelectorAll('[data-issues-input]').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.getAttribute('data-issues-input');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        dcp.issuesNoted = input.value.trim();
        dcp.updatedAt = new Date().toISOString();
        store.upsert('dcps', dcp);
        syncDcpToAdvance(dcp);
        ui.toast('Saved issues note', 'ok');
      });
    });

    // Inline Outcome Selector change
    el.querySelectorAll('[data-outcome-select]').forEach(sel => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-outcome-select');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        dcp.outcome = sel.value;
        if (sel.value === 'Passed') {
          dcp.tested = true;
          dcp.mediaReceived = true;
          dcp.kdmCplReceived = true;
          dcp.playlistMade = true;
          dcp.subsAudioSync = true;
          const crit = ensureQcCriteria(dcp);
          QC_CRITERIA_DEFINITIONS.forEach((def) => {
            crit[def.id] = { status: 'Pass', notes: (crit[def.id] && crit[def.id].notes) || '' };
          });
          if (!dcp.testedByUserId && auth.current()) {
            dcp.testedByUserId = auth.current().id;
            dcp.testedByUserName = auth.displayName(auth.current()) || '';
          }
          if (!dcp.testDateTime) {
            dcp.testDateTime = getNowLocalDateTime();
          }
        } else if (sel.value === 'Pending') {
          dcp.tested = false;
        }
        dcp.updatedAt = new Date().toISOString();
        store.upsert('dcps', dcp);
        syncDcpToAdvance(dcp);
        ui.toast('Updated outcome to ' + sel.value, 'ok');
        renderView();
      });
    });

    // Log / Convert to Task button
    el.querySelectorAll('[data-log-task]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-log-task');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        const actionText = dcp.furtherAction || dcp.issuesNoted || 'Follow-up required before screening';
        const task = createOrUpdateFollowUpTask(dcp, actionText);
        if (task) {
          ui.toast('Task #' + task.id.slice(0, 8) + ' created in Maintenance queue!', 'ok');
          renderView();
        }
      });
    });

    // Add Follow-up Action prompt button
    el.querySelectorAll('[data-add-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-add-action');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        openSignoffModal(dcp);
      });
    });

    // Open QC Report (or Edit Screen if not signed off)
    el.querySelectorAll('[data-open-report]').forEach(elem => {
      elem.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = elem.getAttribute('data-open-report');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        if (isDcpSignedOff(dcp)) {
          openQcReportModal(dcp);
        } else {
          openSignoffModal(dcp);
        }
      });
    });

    // Open Sign-off Modal
    el.querySelectorAll('[data-open-signoff]').forEach(elem => {
      elem.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = elem.getAttribute('data-open-signoff');
        const dcp = store.find('dcps', id);
        if (dcp) openSignoffModal(dcp);
      });
    });

    // Delete / Remove Screening (watertight tracker-only dismissal)
    el.querySelectorAll('[data-delete-dcp]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-delete-dcp');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        handleDeleteScreening(dcp, () => renderView());
      });
    });
  }

  // Initial render + hydrate shared cloud dismissals in background
  renderView();
  eng.hydrateDismissalsFromDb().then(() => {
    if (document.body.contains(el) && !eng.isSyncing()) {
      renderView();
    }
  }).catch(() => {});

  // Keep Pre-Screening Tracker live-synced when Advancing/DCPs/Bookings update in background
  if (RMTP._dcpUnsubscribe) {
    try { RMTP._dcpUnsubscribe(); } catch (e) { /* ignore */ }
    RMTP._dcpUnsubscribe = null;
  }
  if (store.onChange) {
    let _refreshTimer = null;
    RMTP._dcpUnsubscribe = store.onChange((col) => {
      if (eng.isSyncing()) return;
      if (col && col !== 'advancing' && col !== 'dcps' && col !== 'bookings') return;
      if (!document.body.contains(el)) {
        if (RMTP._dcpUnsubscribe) RMTP._dcpUnsubscribe();
        RMTP._dcpUnsubscribe = null;
        return;
      }
      // Do not clobber an active input field while typing
      const activeEl = document.activeElement;
      if (activeEl && el.contains(activeEl) && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        return;
      }
      clearTimeout(_refreshTimer);
      _refreshTimer = setTimeout(() => {
        if (document.body.contains(el) && !eng.isSyncing()) renderView();
      }, 180);
    });
  }

  // If a specific screening ID was passed in query e.g. #/dcp?id=dcp-123, open its modal automatically
  if (query && query.id) {
    const allDcps = store.all('dcps') || [];
    const target = allDcps.find(d =>
      d.id === query.id ||
      d.eventId === query.id ||
      ('dcp-' + d.eventId) === query.id ||
      (Array.isArray(d.linkedEventIds) && d.linkedEventIds.includes(query.id))
    );
    if (target) {
      setTimeout(() => openSignoffModal(target), 100);
    }
  }
};
