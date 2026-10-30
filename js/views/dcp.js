/* ============================================================
   views/dcp.js — Pre-Screening Tracker & Cinema QC Console
   ------------------------------------------------------------
   Simplified, booth-friendly pre-screening tracker capturing:
   1. What media type is the screening?
   2. Has the Media been received?
   3. Have any required KDM's or CPL's been received?
   4. Has a playlist been made?
   5. Has it been tested?
   6. Are there holding slides?
   7. Do the subtitles and audio sync?
   8. Any issues noted?
   9. Outcome of testing (Passed, Passed with Caveats, Failed, Pending)
   10. Any further action? (Creates a task with a follow-up action)
   ============================================================ */

RMTP.views.dcp = function (el, params, query) {
  const ui = RMTP.ui, store = RMTP.store, auth = RMTP.auth;

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

  // Media options matching Event Advancing
  const MEDIA_TYPES = RMTP.MEDIA_TYPES || ['DCP', 'Laptop via HDMI', 'Blu-Ray', 'HDMI (Other)'];
  RMTP.MEDIA_TYPES = MEDIA_TYPES;

  // Screen Hardware Serial Reference
  const HARDWARE_MEDIA_BLOCKS = {
    'Screen One': 'Screen One — Barco DP2K-10S / Dolby IMS3000 (#IMS-884920)',
    'Screen Two': 'Screen Two — Christie CP2210 / Doremi DCP-2000 (#DOR-491208)',
    'Screen Three': 'Screen Three — NEC NC900C / GDC SR-1000 (#GDC-102944)'
  };
  RMTP.HARDWARE_MEDIA_BLOCKS = HARDWARE_MEDIA_BLOCKS;

  function isCinemaSpace(sp) {
    if (!sp) return false;
    if (Array.isArray(sp)) return sp.some(s => /Screen|Cinema/i.test(String(s || '')));
    return /Screen|Cinema/i.test(String(sp || ''));
  }
  RMTP.isCinemaSpace = isCinemaSpace;

  function userName(id) {
    if (!id) return '';
    const u = store.find('users', id);
    return u ? auth.displayName(u) : id;
  }

  function resolveNormalizedScreen(sp, rm) {
    let raw = 'Screen One';
    if (Array.isArray(sp)) {
      const match = sp.find(s => /Screen|Cinema/i.test(String(s)));
      raw = match || sp[0] || 'Screen One';
    } else if (sp) {
      raw = sp;
    } else if (rm) {
      raw = rm;
    }
    const sLower = String(raw).toLowerCase();
    if (sLower.includes('screen 3') || sLower.includes('screen three') || sLower.includes('cinema 3') || sLower.includes('cinema three')) {
      return 'Screen Three';
    }
    if (sLower.includes('screen 2') || sLower.includes('screen two') || sLower.includes('cinema 2') || sLower.includes('cinema two')) {
      return 'Screen Two';
    }
    if (sLower.includes('screen 1') || sLower.includes('screen one') || sLower.includes('cinema 1') || sLower.includes('cinema one') || sLower.includes('cinema bar')) {
      return 'Screen One';
    }
    return HARDWARE_MEDIA_BLOCKS[raw] ? raw : 'Screen One';
  }

  /* ---- Create / Link Task in Maintenance Queue ---- */
  function createOrUpdateFollowUpTask(screening, actionText) {
    if (!screening || !actionText || !actionText.trim()) return null;
    const text = actionText.trim();
    let task = null;

    if (screening.linkedTaskId) {
      task = store.find('maintenance', screening.linkedTaskId);
    }

    if (task) {
      task.description = text + (screening.issuesNoted ? '\n\nIssues noted: ' + screening.issuesNoted.trim() : '');
      task.space = screening.screen || 'Screen One';
      task.updatedAt = Date.now();
      store.upsert('maintenance', task);
    } else {
      const taskId = store.uid('fault');
      task = {
        id: taskId,
        status: 'Open',
        taskType: 'action',
        equipment: (screening.filmTitle || screening.eventName || 'Cinema') + ' — Pre-Screening Follow-up',
        category: 'AV',
        priority: screening.outcome === 'Failed' ? 'High' : 'Medium',
        space: screening.screen || 'Screen One',
        reportedBy: auth.displayName(auth.current()) || 'Cinema Tech',
        assignedTechId: screening.testedByUserId || '',
        assignedTechName: screening.testedByUserName || '',
        description: text + (screening.issuesNoted ? '\n\nIssues noted: ' + screening.issuesNoted.trim() : ''),
        linkedScreeningId: screening.id,
        linkedEventId: screening.eventId || '',
        createdAt: Date.now()
      };
      store.upsert('maintenance', task);
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

  /* ---- Bi-directional Bridge: Pre-Screening Tracker <-> Event Advancing ---- */
  function syncDcpToAdvance(dcp) {
    if (!dcp || !dcp.eventId) return;
    const ev = store.find('advancing', dcp.eventId);
    if (!ev) return;
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

    const isPassed = dcp.outcome === 'Passed';
    if (ev.checks_completed !== isPassed || ev.checksCompleted !== isPassed) {
      ev.checks_completed = isPassed;
      ev.checksCompleted = isPassed;
      changed = true;
    }

    if (dcp.outcome && (ev.qc_status !== dcp.outcome || ev.dcp_qc_status !== dcp.outcome)) {
      ev.qc_status = dcp.outcome;
      ev.dcp_qc_status = dcp.outcome;
      changed = true;
    }

    if (dcp.issuesNoted !== undefined && ev.dcp_notes !== dcp.issuesNoted) {
      ev.dcp_notes = dcp.issuesNoted;
      changed = true;
    }

    if (dcp.testedByUserId && ev.dcp_tester_user_id !== dcp.testedByUserId) {
      ev.dcp_tester_user_id = dcp.testedByUserId;
      ev.dcpTesterUserId = dcp.testedByUserId;
      changed = true;
    }

    if (dcp.testDateTime && ev.dcp_test_datetime !== dcp.testDateTime) {
      ev.dcp_test_datetime = dcp.testDateTime;
      ev.dcpTestDatetime = dcp.testDateTime;
      changed = true;
    }

    if (dcp.furtherAction !== undefined && ev.further_action !== dcp.furtherAction) {
      ev.further_action = dcp.furtherAction;
      ev.furtherAction = dcp.furtherAction;
      changed = true;
    }

    if (dcp.linkedTaskId && ev.linked_task_id !== dcp.linkedTaskId) {
      ev.linked_task_id = dcp.linkedTaskId;
      ev.linkedTaskId = dcp.linkedTaskId;
      changed = true;
    }

    if (changed) {
      store.upsert('advancing', ev);
      if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
    }
  }
  RMTP.syncDcpToAdvance = syncDcpToAdvance;

  function syncAdvanceToDcp(ev) {
    if (!ev) return;
    const isCinema = isCinemaSpace(ev.space) || isCinemaSpace(ev.room);
    const isDcpCategory = (ev.category === 'Cinema' || ev.category === 'DCP Test');
    const media = ev.media_type || ev.mediaType || '';
    const isFilmTitle = /screening|film|cinema|dcp|preview|premiere|q&a|docu|movie/i.test(ev.name || ev.title || '');
    const isScreenEvent = isCinema || isDcpCategory || isFilmTitle || media === 'DCP' || ev.dcp_received || ev.dcpReceived;
    if (!isScreenEvent) return;

    const allDcps = store.all('dcps') || [];
    let existing = allDcps.find(d => d.eventId === ev.id || d.id === 'dcp-' + ev.id);
    const normalizedScreen = resolveNormalizedScreen(ev.space, ev.room);

    if (existing) {
      let changed = false;
      if (ev.name && existing.eventName !== ev.name) { existing.eventName = ev.name; existing.filmTitle = ev.name; changed = true; }
      const mType = ev.media_type !== undefined ? ev.media_type : (ev.mediaType || '');
      if (existing.mediaType !== mType) { existing.mediaType = mType; changed = true; }
      if (ev.date && existing.eventDate !== ev.date) { existing.eventDate = ev.date; changed = true; }
      const sTime = ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '';
      if (sTime && existing.eventStartTime !== sTime) { existing.eventStartTime = sTime; changed = true; }
      if (ev.finishTime && existing.eventFinishTime !== ev.finishTime) { existing.eventFinishTime = ev.finishTime; changed = true; }
      if (ev.space && existing.screen !== normalizedScreen && !existing._manualScreen) {
        existing.screen = normalizedScreen;
        existing.targetHardware = HARDWARE_MEDIA_BLOCKS[normalizedScreen] || (normalizedScreen + ' Media Block');
        changed = true;
      }
      if (ev.dcp_received !== undefined || ev.dcpReceived !== undefined) {
        const isRec = !!(ev.dcp_received || ev.dcpReceived);
        if (existing.mediaReceived !== isRec) { existing.mediaReceived = isRec; changed = true; }
      }
      if (ev.checks_completed !== undefined || ev.checksCompleted !== undefined) {
        const isPassed = !!(ev.checks_completed || ev.checksCompleted);
        if (isPassed && existing.outcome !== 'Passed') { existing.outcome = 'Passed'; changed = true; }
        if (isPassed && !existing.tested) { existing.tested = true; changed = true; }
      }
      if (ev.qc_status && existing.outcome !== ev.qc_status) { existing.outcome = ev.qc_status; changed = true; }
      if (ev.dcp_notes && existing.issuesNoted !== ev.dcp_notes) { existing.issuesNoted = ev.dcp_notes; changed = true; }
      if (ev.further_action && existing.furtherAction !== ev.further_action) {
        existing.furtherAction = ev.further_action;
        existing.hasFurtherAction = true;
        changed = true;
      }
      if (ev.linked_task_id && existing.linkedTaskId !== ev.linked_task_id) {
        existing.linkedTaskId = ev.linked_task_id;
        changed = true;
      }
      if (changed) {
        existing.updatedAt = new Date().toISOString();
        store.upsert('dcps', existing);
      }
    } else {
      const isRcvd = !!(ev.dcp_received || ev.dcpReceived);
      const isPassed = !!(ev.checks_completed || ev.checksCompleted);
      const outcomeVal = isPassed ? 'Passed' : (ev.qc_status || 'Pending');

      const newRec = {
        id: 'dcp-' + ev.id,
        eventId: ev.id,
        eventName: ev.name,
        filmTitle: ev.name,
        mediaType: ev.media_type || ev.mediaType || '',
        eventDate: ev.date || '',
        eventStartTime: ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '',
        eventFinishTime: ev.finishTime || '',
        screen: normalizedScreen,
        targetHardware: HARDWARE_MEDIA_BLOCKS[normalizedScreen] || (normalizedScreen + ' Media Block'),
        // Simplified Checklist
        mediaReceived: isRcvd,
        kdmCplReceived: (media === 'DCP' ? isRcvd : true),
        playlistMade: isPassed,
        tested: isPassed,
        holdingSlidesReady: false,
        subsAudioSync: isPassed,
        issuesNoted: (ev.dcp_notes || ev.techInfo || '').trim(),
        outcome: outcomeVal,
        hasFurtherAction: !!ev.further_action,
        furtherAction: ev.further_action || '',
        linkedTaskId: ev.linked_task_id || '',
        testedByUserId: ev.dcp_tester_user_id || ev.dcpTesterUserId || '',
        testedByUserName: userName(ev.dcp_tester_user_id || ev.dcpTesterUserId),
        testDateTime: ev.dcp_test_datetime || ev.dcpTestDatetime || '',
        createdAt: ev.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.upsert('dcps', newRec);
    }
  }
  RMTP.syncAdvanceToDcp = syncAdvanceToDcp;

  /* ---- Auto-Sync Engine: Bridge all screen events into `dcps` ---- */
  function syncAdvancingToDcps() {
    const allAdv = store.all('advancing').filter(x => !x.deleted);
    let dcps = store.all('dcps') || [];
    let modified = false;

    // First run seed if entirely empty
    if (!dcps.length) {
      const initialDcpSeeds = [
        {
          id: 'dcp-seed-01',
          eventId: '',
          eventName: 'Past Lives',
          filmTitle: 'Past Lives',
          mediaType: 'DCP',
          eventDate: '2026-10-20',
          eventStartTime: '19:30',
          eventFinishTime: '21:30',
          screen: 'Screen One',
          targetHardware: HARDWARE_MEDIA_BLOCKS['Screen One'],
          mediaReceived: true,
          kdmCplReceived: true,
          playlistMade: true,
          tested: true,
          holdingSlidesReady: true,
          subsAudioSync: true,
          issuesNoted: 'Framing 1.85:1 verified. Audio anchored cleanly to Centre.',
          outcome: 'Passed',
          hasFurtherAction: false,
          furtherAction: '',
          linkedTaskId: '',
          testedByUserId: 'user-3',
          testedByUserName: 'Sam Okafor',
          testDateTime: '2026-10-20T14:30:00',
          createdAt: '2026-10-20T10:00:00Z',
          updatedAt: '2026-10-20T14:35:00Z'
        },
        {
          id: 'dcp-seed-02',
          eventId: '',
          eventName: 'Anatomy of a Fall',
          filmTitle: 'Anatomy of a Fall',
          mediaType: 'DCP',
          eventDate: '2026-10-22',
          eventStartTime: '19:00',
          eventFinishTime: '21:45',
          screen: 'Screen Two',
          targetHardware: HARDWARE_MEDIA_BLOCKS['Screen Two'],
          mediaReceived: true,
          kdmCplReceived: true,
          playlistMade: true,
          tested: true,
          holdingSlidesReady: true,
          subsAudioSync: true,
          issuesNoted: 'Scope 2.39:1 masking auto-triggered. Dialogue centered.',
          outcome: 'Passed',
          hasFurtherAction: false,
          furtherAction: '',
          linkedTaskId: '',
          testedByUserId: 'user-4',
          testedByUserName: 'Danny Cole',
          testDateTime: '2026-10-22T11:00:00',
          createdAt: '2026-10-22T09:00:00Z',
          updatedAt: '2026-10-22T11:15:00Z'
        },
        {
          id: 'dcp-seed-03',
          eventId: '',
          eventName: 'East End Shorts Festival: Showcase Reel',
          filmTitle: 'East End Shorts Reel A',
          mediaType: 'Laptop via HDMI',
          eventDate: '2026-10-23',
          eventStartTime: '20:00',
          eventFinishTime: '21:30',
          screen: 'Screen Three',
          targetHardware: HARDWARE_MEDIA_BLOCKS['Screen Three'],
          mediaReceived: true,
          kdmCplReceived: true,
          playlistMade: false,
          tested: true,
          holdingSlidesReady: false,
          subsAudioSync: true,
          issuesNoted: 'Audio level variance between shorts 2 and 3; keep booth fader at 6.5.',
          outcome: 'Passed with Caveats',
          hasFurtherAction: true,
          furtherAction: 'Provide audio booster lead at booth desk before 19:30 doors',
          linkedTaskId: '',
          testedByUserId: 'user-3',
          testedByUserName: 'Sam Okafor',
          testDateTime: '2026-10-23T09:15:00',
          createdAt: '2026-10-23T08:00:00Z',
          updatedAt: '2026-10-23T09:30:00Z'
        }
      ];
      initialDcpSeeds.forEach(s => store.upsert('dcps', s));
      dcps = store.all('dcps');
    }

    allAdv.forEach(ev => {
      const isCinema = isCinemaSpace(ev.space) || isCinemaSpace(ev.room);
      const isDcpCategory = (ev.category === 'Cinema' || ev.category === 'DCP Test');
      const media = ev.media_type || ev.mediaType || '';
      const isFilmTitle = /screening|film|cinema|dcp|preview|premiere|q&a|docu|movie/i.test(ev.name || ev.title || '');
      const isScreenEvent = isCinema || isDcpCategory || isFilmTitle || media === 'DCP' || ev.dcp_received || ev.dcpReceived;

      if (!isScreenEvent) return;

      const existing = dcps.find(d => d.eventId === ev.id || d.id === 'dcp-' + ev.id);
      const normalizedScreen = resolveNormalizedScreen(ev.space, ev.room);

      if (!existing) {
        const isRec = !!(ev.dcp_received || ev.dcpReceived);
        const isPassed = !!(ev.checks_completed || ev.checksCompleted);
        const outcomeVal = isPassed ? 'Passed' : (ev.qc_status || 'Pending');

        const newRec = {
          id: 'dcp-' + ev.id,
          eventId: ev.id,
          eventName: ev.name,
          filmTitle: ev.name,
          mediaType: ev.media_type || ev.mediaType || '',
          eventDate: ev.date || '',
          eventStartTime: ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '',
          eventFinishTime: ev.finishTime || '',
          screen: normalizedScreen,
          targetHardware: HARDWARE_MEDIA_BLOCKS[normalizedScreen] || (normalizedScreen + ' Media Block'),
          mediaReceived: isRec,
          kdmCplReceived: (media === 'DCP' ? isRec : true),
          playlistMade: isPassed,
          tested: isPassed,
          holdingSlidesReady: false,
          subsAudioSync: isPassed,
          issuesNoted: (ev.dcp_notes || ev.techInfo || '').trim(),
          outcome: outcomeVal,
          hasFurtherAction: !!ev.further_action,
          furtherAction: ev.further_action || '',
          linkedTaskId: ev.linked_task_id || '',
          testedByUserId: ev.dcp_tester_user_id || ev.dcpTesterUserId || '',
          testedByUserName: userName(ev.dcp_tester_user_id || ev.dcpTesterUserId),
          testDateTime: ev.dcp_test_datetime || ev.dcpTestDatetime || '',
          createdAt: ev.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        store.upsert('dcps', newRec);
        modified = true;
      } else {
        let changed = false;
        if (existing.eventName !== ev.name) { existing.eventName = ev.name; changed = true; }
        if (!existing.filmTitle) { existing.filmTitle = ev.name; changed = true; }
        const mType = ev.media_type || ev.mediaType || '';
        if (existing.mediaType !== mType) { existing.mediaType = mType; changed = true; }
        if (ev.date && existing.eventDate !== ev.date) { existing.eventDate = ev.date; changed = true; }
        const sTime = ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '';
        if (sTime && existing.eventStartTime !== sTime) { existing.eventStartTime = sTime; changed = true; }
        if (ev.space && existing.screen !== normalizedScreen && !existing._manualScreen) {
          existing.screen = normalizedScreen;
          existing.targetHardware = HARDWARE_MEDIA_BLOCKS[normalizedScreen] || (normalizedScreen + ' Media Block');
          changed = true;
        }
        if (ev.dcp_received !== undefined && existing.mediaReceived !== !!ev.dcp_received) {
          existing.mediaReceived = !!ev.dcp_received;
          changed = true;
        }
        if (ev.checks_completed && existing.outcome !== 'Passed') {
          existing.outcome = 'Passed';
          existing.tested = true;
          changed = true;
        }
        if (ev.dcp_notes && existing.issuesNoted !== ev.dcp_notes) {
          existing.issuesNoted = ev.dcp_notes;
          changed = true;
        }
        if (ev.further_action && existing.furtherAction !== ev.further_action) {
          existing.furtherAction = ev.further_action;
          existing.hasFurtherAction = true;
          changed = true;
        }
        if (ev.linked_task_id && existing.linkedTaskId !== ev.linked_task_id) {
          existing.linkedTaskId = ev.linked_task_id;
          changed = true;
        }
        if (changed) {
          existing.updatedAt = new Date().toISOString();
          store.upsert('dcps', existing);
          modified = true;
        }
      }
    });

    if (modified) {
      dcps = store.all('dcps');
    }
    return dcps;
  }
  RMTP.syncAdvancingToDcps = syncAdvancingToDcps;

  /* ---- Filter State ---- */
  let activeScreenTab = 'all'; // 'all', 'Screen One', 'Screen Two', 'Screen Three'
  let activeOutcomeFilter = 'all'; // 'all', 'Passed', 'Pending', 'Caveats', 'Failed'
  let activeDateFilter = 'upcoming'; // 'upcoming' (default), 'all', 'past'
  let excludePast = true;
  let searchTerm = '';

  function renderView() {
    const dcps = syncAdvancingToDcps();
    const todayIso = new Date().toISOString().slice(0, 10);

    // Calculate KPI metrics & date buckets
    const totalCount = dcps.length;
    const upcomingCount = dcps.filter(d => !d.eventDate || d.eventDate >= todayIso).length;
    const pastCount = dcps.filter(d => d.eventDate && d.eventDate < todayIso).length;
    const passedCount = dcps.filter(d => d.outcome === 'Passed').length;
    const pendingCount = dcps.filter(d => !d.outcome || d.outcome === 'Pending').length;
    const actionRequiredCount = dcps.filter(d => d.hasFurtherAction || d.outcome === 'Failed').length;
    const mediaReadyCount = dcps.filter(d => d.mediaReceived && d.kdmCplReceived).length;

    // Filter list
    let filtered = dcps.slice();

    if (activeScreenTab !== 'all') {
      filtered = filtered.filter(d => d.screen === activeScreenTab);
    }

    // Date filtering and past screening exclusion
    if (activeDateFilter === 'upcoming' || (excludePast && activeDateFilter !== 'all' && activeDateFilter !== 'past')) {
      filtered = filtered.filter(d => !d.eventDate || d.eventDate >= todayIso);
    } else if (activeDateFilter === 'past') {
      filtered = filtered.filter(d => d.eventDate && d.eventDate < todayIso);
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
            '<button id="btn-sync-dcps" class="btn btn-ghost text-xs flex items-center gap-1.5" title="Re-sync latest screenings from Artifax">' +
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

          // Informational banner when past screenings are excluded
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
                      '<th class="py-2.5 px-3 min-w-[340px]">Pre-Screening Checklist</th>' +
                      '<th class="py-2.5 px-3 min-w-[180px]">Issues Noted</th>' +
                      '<th class="py-2.5 px-3 min-w-[140px]">Outcome</th>' +
                      '<th class="py-2.5 px-3 min-w-[170px]">Further Action / Task</th>' +
                      '<th class="py-2.5 px-3 text-right sticky right-0 bg-panel2/90 z-20 w-[140px] min-w-[140px] shadow-[-8px_0_10px_-4px_rgba(0,0,0,0.3)]">Sign-off</th>' +
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

  /* ---- Render Desktop Row ---- */
  function renderScreeningRow(dcp) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const isPast = dcp.eventDate && dcp.eventDate < todayIso;

    // Outcome Badge
    let outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-panel2 text-muted border border-line">Pending</span>';
    if (dcp.outcome === 'Passed') {
      outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-ok/15 text-ok border border-ok/30">' + ui.icon('check', 'w-3 h-3') + 'PASSED</span>';
    } else if (dcp.outcome === 'Passed with Caveats') {
      outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-warning/15 text-warning border border-warning/30">CAVEATS</span>';
    } else if (dcp.outcome === 'Failed') {
      outcomeBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-danger/15 text-danger border border-danger/30">' + ui.icon('x', 'w-3 h-3') + 'FAILED</span>';
    }

    // Task display
    let taskHtml = '';
    if (dcp.linkedTaskId) {
      const task = store.find('maintenance', dcp.linkedTaskId);
      const isResolved = task && task.status === 'Resolved';
      taskHtml =
        '<div class="space-y-1">' +
          '<a href="#/maintenance" class="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded font-semibold ' +
            (isResolved ? 'bg-ok/15 text-ok border border-ok/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:underline') + '" title="View linked task in Maintenance">' +
            ui.icon('wrench', 'w-3 h-3') + '<span>Task #' + ui.esc(dcp.linkedTaskId.slice(0, 10)) + (isResolved ? ' (Done)' : ' (Open)') + '</span>' +
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
            ui.icon('plus', 'w-3 h-3') + '<span>Convert to Task</span>' +
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
        // 1. Media Type & Advance Dropdown (first column as requested)
        '<td class="py-3 px-3 align-top min-w-[170px] border-b border-line/60">' +
          '<div class="mb-1.5">' +
            '<select data-screening-media="' + dcp.id + '" class="field !py-1 !px-2 !text-xs font-semibold bg-panel border-line text-ink w-full shadow-2xs" title="Screening Media Type (Bidirectional with Event Advance)">' +
              '<option value="">\u2014 Blank \u2014</option>' +
              MEDIA_TYPES.map(m =>
                '<option value="' + m + '"' + (dcp.mediaType === m ? ' selected' : '') + '>' + m + '</option>'
              ).join('') +
            '</select>' +
          '</div>' +
          '<div class="flex items-center gap-1.5 font-mono text-[11px] text-muted">' +
            ui.icon('calendar', 'w-3 h-3 text-muted shrink-0') +
            '<span>' + ui.esc(dcp.eventDate || 'Date TBC') + '</span>' +
            (dcp.eventStartTime ? '<span class="text-ink font-semibold">' + ui.esc(dcp.eventStartTime) + '</span>' : '') +
          '</div>' +
          '<div class="mt-1">' +
            '<span class="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-panel2 text-muted border border-line">' +
              ui.icon('pin', 'w-2.5 h-2.5 text-accent') + ui.esc(dcp.screen || 'Screen One') +
            '</span>' +
          '</div>' +
        '</td>' +

        // 2. Film & Screening Title
        '<td class="py-3 px-3 align-top min-w-[200px] max-w-[300px] border-b border-line/60">' +
          '<div class="font-display font-bold text-ink text-sm group-hover:text-accent transition-colors cursor-pointer" data-open-signoff="' + dcp.id + '" title="Click to open pre-screening sign-off sheet">' +
            ui.esc(dcp.filmTitle || dcp.eventName || 'Screening') +
          '</div>' +
          '<div class="text-[11px] text-muted mt-0.5">' +
            (dcp.testedByUserName ? 'Tested by <span class="text-ink font-medium">' + ui.esc(dcp.testedByUserName) + '</span>' : '<span class="text-muted/80">Untested</span>') +
            (dcp.testDateTime ? ' \u00b7 ' + new Date(dcp.testDateTime).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '') +
          '</div>' +
        '</td>' +

        // 3. Pre-Screening Checklist (6 Interactive Checkboxes right in row!)
        '<td class="py-3 px-3 align-top min-w-[340px] border-b border-line/60">' +
          '<div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] select-none">' +
            '<label class="flex items-center gap-1.5 cursor-pointer hover:text-ink ' + (dcp.mediaReceived ? 'text-ok font-medium' : 'text-muted') + '">' +
              '<input type="checkbox" data-check-field="mediaReceived" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.mediaReceived ? 'checked' : '') + ' />' +
              '<span>Media Received</span>' +
            '</label>' +

            '<label class="flex items-center gap-1.5 cursor-pointer hover:text-ink ' + (dcp.kdmCplReceived ? 'text-ok font-medium' : 'text-muted') + '">' +
              '<input type="checkbox" data-check-field="kdmCplReceived" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.kdmCplReceived ? 'checked' : '') + ' />' +
              '<span>KDM / CPL Rcvd</span>' +
            '</label>' +

            '<label class="flex items-center gap-1.5 cursor-pointer hover:text-ink ' + (dcp.playlistMade ? 'text-ok font-medium' : 'text-muted') + '">' +
              '<input type="checkbox" data-check-field="playlistMade" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.playlistMade ? 'checked' : '') + ' />' +
              '<span>Playlist Made</span>' +
            '</label>' +

            '<label class="flex items-center gap-1.5 cursor-pointer hover:text-ink ' + (dcp.tested ? 'text-ok font-medium' : 'text-muted') + '">' +
              '<input type="checkbox" data-check-field="tested" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.tested ? 'checked' : '') + ' />' +
              '<span>Tested in Booth</span>' +
            '</label>' +

            '<label class="flex items-center gap-1.5 cursor-pointer hover:text-ink ' + (dcp.holdingSlidesReady ? 'text-ok font-medium' : 'text-muted') + '">' +
              '<input type="checkbox" data-check-field="holdingSlidesReady" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.holdingSlidesReady ? 'checked' : '') + ' />' +
              '<span>Holding Slides</span>' +
            '</label>' +

            '<label class="flex items-center gap-1.5 cursor-pointer hover:text-ink ' + (dcp.subsAudioSync ? 'text-ok font-medium' : 'text-muted') + '">' +
              '<input type="checkbox" data-check-field="subsAudioSync" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.subsAudioSync ? 'checked' : '') + ' />' +
              '<span>Audio &amp; Subs Sync</span>' +
            '</label>' +
          '</div>' +
        '</td>' +

        // 4. Issues Noted (Inline text input with auto-save)
        '<td class="py-3 px-3 align-top min-w-[180px] border-b border-line/60">' +
          '<input type="text" data-issues-input="' + dcp.id + '" value="' + ui.esc(dcp.issuesNoted || '') + '" placeholder="Any issues noted..." class="field !py-1 !px-2 !text-xs w-full bg-panel text-ink" title="Type issues noted and press Enter or click outside to save" />' +
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
        '<td class="py-3 px-3 align-middle text-right whitespace-nowrap min-w-[140px] w-[140px] sticky right-0 bg-panel group-hover:bg-[#1a202a] transition-colors z-10 shadow-[-10px_0_12px_-4px_rgba(0,0,0,0.45)] border-b border-l border-line/60">' +
          '<div class="flex items-center justify-end gap-1.5 shrink-0">' +
            '<button type="button" data-open-signoff="' + dcp.id + '" class="btn btn-primary !py-1 !px-2 text-xs font-semibold flex items-center gap-1 shadow-2xs whitespace-nowrap" title="Open Full Sign-off Sheet">' +
              ui.icon('check', 'w-3.5 h-3.5') + '<span>Sign-off</span>' +
            '</button>' +
            '<button type="button" data-delete-dcp="' + dcp.id + '" class="btn btn-danger !p-1.5 !h-7 !w-7 min-h-0 shrink-0 inline-flex items-center justify-center rounded-lg" title="Delete Screening Record">' +
              ui.icon('trash', 'w-3.5 h-3.5') +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>'
    );
  }

  /* ---- Render Mobile Card (< md) ---- */
  function renderScreeningMobileCard(dcp) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const isPast = dcp.eventDate && dcp.eventDate < todayIso;

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
              ui.icon('calendar', 'w-3 h-3') + ui.esc(dcp.eventDate || 'Date TBC') +
              (dcp.eventStartTime ? ' <strong class="text-ink">' + ui.esc(dcp.eventStartTime) + '</strong>' : '') +
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
          '<div class="font-display font-bold text-ink text-base cursor-pointer hover:text-accent" data-open-signoff="' + dcp.id + '">' +
            ui.esc(dcp.filmTitle || dcp.eventName || 'Screening') +
          '</div>' +
          '<div class="text-xs text-muted mt-0.5">' +
            (dcp.testedByUserName ? 'Tested by ' + ui.esc(dcp.testedByUserName) : 'Untested') +
          '</div>' +
        '</div>' +

        // 6 Checklist items
        '<div class="grid grid-cols-2 gap-2 p-3 rounded-lg bg-panel2/50 border border-line/60 text-xs select-none">' +
          '<label class="flex items-center gap-1.5 cursor-pointer ' + (dcp.mediaReceived ? 'text-ok font-medium' : 'text-muted') + '">' +
            '<input type="checkbox" data-check-field="mediaReceived" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.mediaReceived ? 'checked' : '') + ' />' +
            '<span>Media Received</span>' +
          '</label>' +
          '<label class="flex items-center gap-1.5 cursor-pointer ' + (dcp.kdmCplReceived ? 'text-ok font-medium' : 'text-muted') + '">' +
            '<input type="checkbox" data-check-field="kdmCplReceived" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.kdmCplReceived ? 'checked' : '') + ' />' +
            '<span>KDM / CPL Rcvd</span>' +
          '</label>' +
          '<label class="flex items-center gap-1.5 cursor-pointer ' + (dcp.playlistMade ? 'text-ok font-medium' : 'text-muted') + '">' +
            '<input type="checkbox" data-check-field="playlistMade" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.playlistMade ? 'checked' : '') + ' />' +
            '<span>Playlist Made</span>' +
          '</label>' +
          '<label class="flex items-center gap-1.5 cursor-pointer ' + (dcp.tested ? 'text-ok font-medium' : 'text-muted') + '">' +
            '<input type="checkbox" data-check-field="tested" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.tested ? 'checked' : '') + ' />' +
            '<span>Tested in Booth</span>' +
          '</label>' +
          '<label class="flex items-center gap-1.5 cursor-pointer ' + (dcp.holdingSlidesReady ? 'text-ok font-medium' : 'text-muted') + '">' +
            '<input type="checkbox" data-check-field="holdingSlidesReady" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.holdingSlidesReady ? 'checked' : '') + ' />' +
            '<span>Holding Slides</span>' +
          '</label>' +
          '<label class="flex items-center gap-1.5 cursor-pointer ' + (dcp.subsAudioSync ? 'text-ok font-medium' : 'text-muted') + '">' +
            '<input type="checkbox" data-check-field="subsAudioSync" data-id="' + dcp.id + '" class="w-3.5 h-3.5 rounded accent-[var(--ok)]" ' + (dcp.subsAudioSync ? 'checked' : '') + ' />' +
            '<span>Audio &amp; Subs Sync</span>' +
          '</label>' +
        '</div>' +

        // Issues input
        '<div>' +
          '<label class="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Issues Noted</label>' +
          '<input type="text" data-issues-input="' + dcp.id + '" value="' + ui.esc(dcp.issuesNoted || '') + '" placeholder="Any issues noted..." class="field !py-1.5 !px-2.5 !text-xs w-full bg-panel text-ink" />' +
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
          '<div class="flex items-center gap-2">' +
            '<button type="button" data-open-signoff="' + dcp.id + '" class="btn btn-primary !py-1 !px-2.5 text-xs font-semibold flex items-center gap-1">' +
              ui.icon('check', 'w-3.5 h-3.5') + '<span>Sign-off Sheet</span>' +
            '</button>' +
            '<button type="button" data-delete-dcp="' + dcp.id + '" class="btn btn-danger !p-1.5 !h-7 !w-7 inline-flex items-center justify-center rounded-lg">' +
              ui.icon('trash', 'w-3.5 h-3.5') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---- Open Full Pre-Screening Sign-off Modal ---- */
  function openSignoffModal(existing) {
    const isNew = !existing;
    const item = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: 'dcp-manual-' + store.uid('dcp'),
      eventId: '',
      eventName: '',
      filmTitle: '',
      mediaType: '',
      eventDate: new Date().toISOString().slice(0, 10),
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
      hasFurtherAction: false,
      furtherAction: '',
      linkedTaskId: '',
      testedByUserId: auth.current() ? auth.current().id : '',
      testedByUserName: auth.displayName(auth.current()) || '',
      testDateTime: new Date().toISOString().slice(0, 16),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const users = store.all('users');
    const userOptions = users.map(u =>
      '<option value="' + u.id + '"' + (item.testedByUserId === u.id ? ' selected' : '') + '>' + ui.esc(auth.displayName(u)) + ' (' + ui.esc(u.position || u.role) + ')</option>'
    ).join('');

    const modalBody =
      '<div class="space-y-6 text-xs max-h-[75vh] overflow-y-auto pr-1">' +
        // Panel 1: Screening & Media Identity
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center justify-between">' +
            '<span class="flex items-center gap-1.5">' + ui.icon('film', 'w-3.5 h-3.5') + 'Screening &amp; Media Setup</span>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Film / Screening Title *</label>' +
              '<input type="text" id="m-film-title" value="' + ui.esc(item.filmTitle || item.eventName || '') + '" placeholder="e.g. Past Lives" class="field !text-xs w-full font-semibold text-ink" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Screen / Venue</label>' +
              '<select id="m-screen" class="field !text-xs w-full">' +
                ['Screen One', 'Screen Two', 'Screen Three'].map(s =>
                  '<option value="' + s + '"' + (item.screen === s ? ' selected' : '') + '>' + s + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">What media type is the screening? *</label>' +
              '<select id="m-media-type" class="field !text-xs w-full font-semibold text-ink">' +
                '<option value="">\u2014 Blank (TBC) \u2014</option>' +
                MEDIA_TYPES.map(m =>
                  '<option value="' + m + '"' + (item.mediaType === m ? ' selected' : '') + '>' + m + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
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
          '</div>' +
        '</div>' +

        // Panel 2: Pre-Screening Checklist (The 6 core items)
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center justify-between">' +
            '<span class="flex items-center gap-1.5">' + ui.icon('check', 'w-3.5 h-3.5') + 'Pre-Screening Verification Checklist</span>' +
            '<button type="button" id="btn-quick-pass-all" class="text-accent hover:underline font-semibold cursor-pointer text-[11px] flex items-center gap-1">' +
              ui.icon('check', 'w-3 h-3') + '<span>Mark All Verified</span>' +
            '</button>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-panel border border-line">' +
            '<label class="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-panel2/60 transition-colors">' +
              '<input type="checkbox" id="chk-m-media-rcv" class="w-4 h-4 rounded mt-0.5 accent-[var(--ok)]" ' + (item.mediaReceived ? 'checked' : '') + ' />' +
              '<div>' +
                '<div class="font-semibold text-ink text-xs">Has the Media been received?</div>' +
                '<div class="text-[10px] text-muted">DCP drive, Aspera / Signiant transfer, laptop, or physical disc delivered to booth.</div>' +
              '</div>' +
            '</label>' +

            '<label class="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-panel2/60 transition-colors">' +
              '<input type="checkbox" id="chk-m-kdm-cpl" class="w-4 h-4 rounded mt-0.5 accent-[var(--ok)]" ' + (item.kdmCplReceived ? 'checked' : '') + ' />' +
              '<div>' +
                '<div class="font-semibold text-ink text-xs">Have any required KDM\u2019s or CPL\u2019s been received?</div>' +
                '<div class="text-[10px] text-muted">Key certificate matches media block hardware serial &amp; valid window covers screening.</div>' +
              '</div>' +
            '</label>' +

            '<label class="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-panel2/60 transition-colors">' +
              '<input type="checkbox" id="chk-m-playlist" class="w-4 h-4 rounded mt-0.5 accent-[var(--ok)]" ' + (item.playlistMade ? 'checked' : '') + ' />' +
              '<div>' +
                '<div class="font-semibold text-ink text-xs">Has a playlist been made?</div>' +
                '<div class="text-[10px] text-muted">Show playlist (SPL) assembled on projector server with cues and audio macros.</div>' +
              '</div>' +
            '</label>' +

            '<label class="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-panel2/60 transition-colors">' +
              '<input type="checkbox" id="chk-m-tested" class="w-4 h-4 rounded mt-0.5 accent-[var(--ok)]" ' + (item.tested ? 'checked' : '') + ' />' +
              '<div>' +
                '<div class="font-semibold text-ink text-xs">Has it been tested?</div>' +
                '<div class="text-[10px] text-muted">Full booth pre-screening dry run completed through speakers and screen.</div>' +
              '</div>' +
            '</label>' +

            '<label class="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-panel2/60 transition-colors">' +
              '<input type="checkbox" id="chk-m-slides" class="w-4 h-4 rounded mt-0.5 accent-[var(--ok)]" ' + (item.holdingSlidesReady ? 'checked' : '') + ' />' +
              '<div>' +
                '<div class="font-semibold text-ink text-xs">Are there holding slides?</div>' +
                '<div class="text-[10px] text-muted">Walk-in holding slides, intermission cards, or client sponsor graphics loaded.</div>' +
              '</div>' +
            '</label>' +

            '<label class="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-panel2/60 transition-colors">' +
              '<input type="checkbox" id="chk-m-sync" class="w-4 h-4 rounded mt-0.5 accent-[var(--ok)]" ' + (item.subsAudioSync ? 'checked' : '') + ' />' +
              '<div>' +
                '<div class="font-semibold text-ink text-xs">Do the subtitles and audio sync?</div>' +
                '<div class="text-[10px] text-muted">Subtitles render in-sync with speech; audio channels balanced without delay.</div>' +
              '</div>' +
            '</label>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">' +
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

        // Panel 3: Any issues noted?
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center gap-1.5">' +
            ui.icon('tool', 'w-3.5 h-3.5') + '<span>Any Issues Noted?</span>' +
          '</div>' +
          '<div>' +
            '<textarea id="m-issues" rows="3" placeholder="Note any aspect ratio framing quirks, sound level offsets, missing holding slides, audio sync lag, or distributor notes..." class="field !text-xs w-full leading-relaxed">' + ui.esc(item.issuesNoted || '') + '</textarea>' +
            '<div class="text-[10px] text-muted mt-1">These notes appear directly on the booth checklist and sync with Event Advancing notes.</div>' +
          '</div>' +
        '</div>' +

        // Panel 4: Outcome of Testing
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center gap-1.5">' +
            ui.icon('check', 'w-3.5 h-3.5') + '<span>Outcome of Testing</span>' +
          '</div>' +

          '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' +
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
        '</div>' +

        // Panel 5: Any further action? (Creates a task with a follow up action)
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="flex items-center justify-between">' +
            '<div class="eyebrow text-accent flex items-center gap-1.5">' +
              ui.icon('wrench', 'w-3.5 h-3.5') + '<span>Any Further Action? (Creates a Task with Follow-up Action)</span>' +
            '</div>' +
            (item.linkedTaskId ? (
              '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-ok/15 text-ok border border-ok/30 flex items-center gap-1">' +
                ui.icon('check', 'w-3 h-3') + 'Task Logged in Maintenance' +
              '</span>'
            ) : '') +
          '</div>' +

          '<label class="flex items-center gap-2 cursor-pointer">' +
            '<input type="checkbox" id="chk-m-further-action" class="w-4 h-4 rounded accent-[var(--accent)]" ' + (item.hasFurtherAction || item.furtherAction ? 'checked' : '') + ' />' +
            '<span class="font-semibold text-ink text-xs">Yes, further action required before screening</span>' +
          '</label>' +

          '<div id="further-action-fields" class="' + (item.hasFurtherAction || item.furtherAction ? '' : 'hidden') + ' space-y-2 pt-1">' +
            '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider">Required Follow-up Action *</label>' +
            '<textarea id="m-further-action" rows="2" placeholder="e.g. Request distributor re-send KDM for Screen Two; Swap audio balun at lectern; Adjust lens preset macro..." class="field !text-xs w-full">' + ui.esc(item.furtherAction || '') + '</textarea>' +
            '<div class="p-2.5 rounded-lg bg-panel border border-line text-[11px] text-muted flex items-start gap-2">' +
              ui.icon('wrench', 'w-4 h-4 text-accent shrink-0 mt-0.5') +
              '<span>Saving will automatically create an <strong>Open Maintenance &amp; Action Task</strong> linked to this screening and notify on-duty technicians.</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    const modalFooter =
      '<div class="flex items-center justify-between w-full">' +
        '<div>' +
          (existing ? (
            '<button type="button" id="btn-del-modal-dcp" class="btn btn-danger text-xs flex items-center gap-1.5">' +
              ui.icon('trash', 'w-4 h-4') + '<span>Delete</span>' +
            '</button>'
          ) : '') +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<button type="button" data-cancel class="btn btn-ghost text-xs">Cancel</button>' +
          '<button type="button" id="btn-save-dcp" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5 shadow-2xs">' +
            ui.icon('check', 'w-4 h-4') + '<span>' + (isNew ? 'Create Screening' : 'Save Pre-Screening Sign-off') + '</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    const m = ui.modal({
      title: isNew ? 'Add Manual Screening' : (item.filmTitle || 'Pre-Screening Sign-off'),
      body: modalBody,
      footer: modalFooter,
      maxWidth: 'max-w-2xl'
    });

    // Wire Outcome buttons in modal
    m.root.querySelectorAll('[data-outcome-btn]').forEach(b => {
      b.addEventListener('click', () => {
        const out = b.getAttribute('data-outcome-btn');
        m.root.querySelector('#m-outcome-val').value = out;
        m.root.querySelectorAll('[data-outcome-btn]').forEach(btn => {
          btn.className = 'p-2.5 rounded-lg border text-xs text-center transition-all border-line bg-panel text-muted hover:text-ink';
        });
        let activeClass = 'border-accent bg-accent/15 text-accent font-bold ring-1 ring-accent';
        if (out === 'Passed') activeClass = 'border-ok bg-ok/15 text-ok font-bold ring-1 ring-ok';
        if (out === 'Failed') activeClass = 'border-danger bg-danger/15 text-danger font-bold ring-1 ring-danger';
        if (out === 'Passed with Caveats') activeClass = 'border-warning bg-warning/15 text-warning font-bold ring-1 ring-warning';
        b.className = 'p-2.5 rounded-lg border text-xs text-center transition-all ' + activeClass;
      });
    });

    // Wire Quick Pass All Verified
    const btnQuickPass = m.root.querySelector('#btn-quick-pass-all');
    if (btnQuickPass) {
      btnQuickPass.addEventListener('click', () => {
        m.root.querySelector('#chk-m-media-rcv').checked = true;
        m.root.querySelector('#chk-m-kdm-cpl').checked = true;
        m.root.querySelector('#chk-m-playlist').checked = true;
        m.root.querySelector('#chk-m-tested').checked = true;
        m.root.querySelector('#chk-m-slides').checked = true;
        m.root.querySelector('#chk-m-sync').checked = true;
        // Set outcome to Passed
        const passBtn = m.root.querySelector('[data-outcome-btn="Passed"]');
        if (passBtn) passBtn.click();
        if (!m.root.querySelector('#m-tester').value && auth.current()) {
          m.root.querySelector('#m-tester').value = auth.current().id;
        }
        if (!m.root.querySelector('#m-test-date').value) {
          m.root.querySelector('#m-test-date').value = new Date().toISOString().slice(0, 16);
        }
        ui.toast('Marked all verification checks as complete', 'ok');
      });
    }

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

    // Delete button inside modal
    const btnDel = m.root.querySelector('#btn-del-modal-dcp');
    if (btnDel) {
      btnDel.addEventListener('click', async () => {
        const ok = await ui.confirm('Remove screening record \u201c' + (item.filmTitle || 'Screening') + '\u201d?', {
          title: 'Delete Screening',
          danger: true,
          confirmLabel: 'Remove'
        });
        if (ok) {
          store.remove('dcps', item.id);
          m.close();
          ui.toast('Removed screening record', 'ok');
          renderView();
        }
      });
    }

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);

    // Save button
    const btnSave = m.root.querySelector('#btn-save-dcp');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        const titleVal = m.root.querySelector('#m-film-title')?.value.trim();
        if (!titleVal) {
          ui.toast('Screening Title is required', 'danger');
          m.root.querySelector('#m-film-title')?.focus();
          return;
        }

        const testerId = m.root.querySelector('#m-tester')?.value || '';
        const testerUser = testerId ? store.find('users', testerId) : null;
        const furtherActionReq = m.root.querySelector('#chk-m-further-action')?.checked || false;
        const furtherActionText = m.root.querySelector('#m-further-action')?.value.trim() || '';

        item.filmTitle = titleVal;
        item.eventName = titleVal;
        item.screen = m.root.querySelector('#m-screen')?.value || 'Screen One';
        item._manualScreen = true;
        item.targetHardware = HARDWARE_MEDIA_BLOCKS[item.screen] || (item.screen + ' Media Block');
        item.mediaType = m.root.querySelector('#m-media-type')?.value || '';
        item.eventDate = m.root.querySelector('#m-date')?.value || '';
        item.eventStartTime = m.root.querySelector('#m-start-time')?.value || '';
        item.eventFinishTime = m.root.querySelector('#m-finish-time')?.value || '';

        // Checklist Values
        item.mediaReceived = !!m.root.querySelector('#chk-m-media-rcv')?.checked;
        item.kdmCplReceived = !!m.root.querySelector('#chk-m-kdm-cpl')?.checked;
        item.playlistMade = !!m.root.querySelector('#chk-m-playlist')?.checked;
        item.tested = !!m.root.querySelector('#chk-m-tested')?.checked;
        item.holdingSlidesReady = !!m.root.querySelector('#chk-m-slides')?.checked;
        item.subsAudioSync = !!m.root.querySelector('#chk-m-sync')?.checked;

        item.issuesNoted = m.root.querySelector('#m-issues')?.value.trim() || '';
        item.outcome = m.root.querySelector('#m-outcome-val')?.value || 'Pending';

        item.testedByUserId = testerId;
        item.testedByUserName = testerUser ? auth.displayName(testerUser) : '';
        item.testDateTime = m.root.querySelector('#m-test-date')?.value || '';
        item.updatedAt = new Date().toISOString();

        // Further action & task creation
        if (furtherActionReq && furtherActionText) {
          item.hasFurtherAction = true;
          item.furtherAction = furtherActionText;
          createOrUpdateFollowUpTask(item, furtherActionText);
          ui.toast('Screening saved and Follow-up Task created in Maintenance!', 'ok');
        } else {
          item.hasFurtherAction = false;
          item.furtherAction = '';
          store.upsert('dcps', item);
          syncDcpToAdvance(item);
          if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
          ui.toast('Pre-screening sign-off saved', 'ok');
        }

        m.close();
        renderView();
      });
    }
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
        if (activeDateFilter === 'all' || activeDateFilter === 'past') {
          excludePast = false;
        } else {
          excludePast = true;
        }
        renderView();
      });
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
        // Debounce render slightly
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

    // Sync button (Full refresh from Artifax edge function + local DCP bridge)
    const btnSync = el.querySelector('#btn-sync-dcps');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        btnSync.disabled = true;
        const originalContent = btnSync.innerHTML;
        btnSync.innerHTML = ui.icon('refresh', 'w-4 h-4 animate-spin') + '<span>Syncing with Artifax...</span>';
        try {
          if (RMTP.syncArtifax) {
            await RMTP.syncArtifax(true);
          }
        } catch (err) {
          console.warn('[Pre-Screening] Artifax sync error:', err);
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
      sel.addEventListener('change', (e) => {
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

    // Inline Checklist Checkboxes (Instant auto-save with toast)
    el.querySelectorAll('[data-check-field]').forEach(chk => {
      chk.addEventListener('change', () => {
        const field = chk.getAttribute('data-check-field');
        const id = chk.getAttribute('data-id');
        const dcp = store.find('dcps', id);
        if (!dcp) return;

        dcp[field] = chk.checked;
        dcp.updatedAt = new Date().toISOString();

        // If 'tested' checked, set tester and date if not already set
        if (field === 'tested' && chk.checked) {
          if (!dcp.testedByUserId && curUser) {
            dcp.testedByUserId = curUser.id;
            dcp.testedByUserName = auth.displayName(curUser);
          }
          if (!dcp.testDateTime) {
            dcp.testDateTime = new Date().toISOString();
          }
          if (dcp.outcome === 'Pending') {
            dcp.outcome = 'Passed';
          }
        }

        store.upsert('dcps', dcp);
        syncDcpToAdvance(dcp);
        renderView();
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
        if (sel.value === 'Passed') dcp.tested = true;
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
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-add-action');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        openSignoffModal(dcp);
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

    // Delete Screening
    el.querySelectorAll('[data-delete-dcp]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-delete-dcp');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        const ok = await ui.confirm('Remove screening record \u201c' + (dcp.filmTitle || 'Screening') + '\u201d?', {
          title: 'Delete Screening Record',
          danger: true,
          confirmLabel: 'Remove'
        });
        if (ok) {
          store.remove('dcps', id);
          ui.toast('Screening record removed', 'ok');
          renderView();
        }
      });
    });
  }

  // Initial render
  renderView();

  // If a specific screening ID was passed in query e.g. #/dcp?id=dcp-123, open its modal automatically
  if (query && query.id) {
    const allDcps = store.all('dcps') || [];
    const target = allDcps.find(d => d.id === query.id || d.eventId === query.id || ('dcp-' + d.eventId) === query.id);
    if (target) {
      setTimeout(() => openSignoffModal(target), 100);
    }
  }
};
