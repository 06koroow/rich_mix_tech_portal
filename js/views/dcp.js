/* ============================================================
   views/dcp.js — Digital Cinema Package (DCP) Tracker & QC Console
   ------------------------------------------------------------
   Authoritative registry for digital cinema packages ingested across
   Screen One, Screen Two, and Screen Three at Rich Mix.
   Tracks DCI naming conventions, CPL UUIDs, technical specifications
   (Flat/Scope, 2K/4K, 5.1/7.1, DCI-XYZ), KDM validity windows against
   target server media blocks, and audio/visual QC sign-offs.
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
          'The Digital Cinema Package (DCP) Tracker &amp; QC Console is restricted to Rich Mix staff technicians and managers. Freelancers do not have access to cinema server logs, KDM certificates, or technical QC sign-offs.' +
        '</p>' +
        '<div class="mt-6 flex justify-center gap-3">' +
          '<a href="#/' + RMTP.HOME + '" class="btn btn-primary px-4 py-2 text-sm flex items-center gap-2">' +
            ui.icon('calendar', 'w-4 h-4') + '<span>Return to Event Advancing</span>' +
          '</a>' +
        '</div>' +
      '</div>';
    return;
  }

  // Screen Hardware Serial Reference
  const HARDWARE_MEDIA_BLOCKS = {
    'Screen One': 'Screen One — Barco DP2K-10S / Dolby IMS3000 (#IMS-884920)',
    'Screen Two': 'Screen Two — Christie CP2210 / Doremi DCP-2000 (#DOR-491208)',
    'Screen Three': 'Screen Three — NEC NC900C / GDC SR-1000 (#GDC-102944)'
  };
  RMTP.HARDWARE_MEDIA_BLOCKS = HARDWARE_MEDIA_BLOCKS;

  function isCinemaSpace(sp) {
    if (!sp) return false;
    const s = Array.isArray(sp) ? sp[0] : sp;
    return /Screen|Cinema/i.test(s);
  }

  function userName(id) {
    if (!id) return '';
    const u = store.find('users', id);
    return u ? auth.displayName(u) : id;
  }

  /* ---- Bi-directional Bridge: DCP Tracker <-> Event Advancing ---- */
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
    if (dcp.duration && ev.film_duration !== dcp.duration) {
      ev.film_duration = dcp.duration;
      ev.filmDuration = dcp.duration;
      changed = true;
    }
    if (dcp.aspectRatio && ev.aspect_ratio !== dcp.aspectRatio) {
      ev.aspect_ratio = dcp.aspectRatio;
      ev.aspectRatio = dcp.aspectRatio;
      changed = true;
    }
    if (dcp.soundFaderLevel && ev.sound_fader_level !== dcp.soundFaderLevel) {
      ev.sound_fader_level = dcp.soundFaderLevel;
      ev.soundFaderLevel = dcp.soundFaderLevel;
      changed = true;
    }
    if (dcp.qcStatus) {
      const isPassed = dcp.qcStatus === 'Passed';
      ev.checks_completed = isPassed;
      ev.checksCompleted = isPassed;
      ev.qc_status = dcp.qcStatus;
      ev.dcp_qc_status = dcp.qcStatus;
      changed = true;
    }
    if (dcp.ingestStatus) {
      ev.dcp_received = (dcp.ingestStatus === 'Pass');
      ev.dcpReceived = (dcp.ingestStatus === 'Pass');
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
    if (dcp.qcNotes && ev.dcp_notes !== dcp.qcNotes) {
      ev.dcp_notes = dcp.qcNotes;
      changed = true;
    }
    if (dcp.dciTitle && ev.dci_title !== dcp.dciTitle) {
      ev.dci_title = dcp.dciTitle;
      ev.dciTitle = dcp.dciTitle;
      changed = true;
    }
    if (dcp.cplUuid && ev.cpl_uuid !== dcp.cplUuid) {
      ev.cpl_uuid = dcp.cplUuid;
      ev.cplUuid = dcp.cplUuid;
      changed = true;
    }
    if (dcp.kdmValidFrom && ev.kdm_valid_from !== dcp.kdmValidFrom) {
      ev.kdm_valid_from = dcp.kdmValidFrom;
      changed = true;
    }
    if (dcp.kdmValidTo && ev.kdm_valid_to !== dcp.kdmValidTo) {
      ev.kdm_valid_to = dcp.kdmValidTo;
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
    const isCinema = isCinemaSpace(ev.space);
    const isDcpCategory = (ev.category === 'Cinema' || ev.category === 'DCP Test');
    const media = ev.media_type || ev.mediaType || '';
    const isScreenEvent = isCinema || isDcpCategory || media === 'DCP' || ev.dcp_received || ev.dcpReceived;
    if (!isScreenEvent) return;

    const allDcps = store.all('dcps') || [];
    let existing = allDcps.find(d => d.eventId === ev.id || d.id === 'dcp-' + ev.id);
    const screenName = Array.isArray(ev.space) ? ev.space[0] : (ev.space || 'Screen One');
    const normalizedScreen = screenName.indexOf('Screen') === -1 ? 'Screen One' : screenName;

    if (existing) {
      let changed = false;
      if (ev.name && existing.eventName !== ev.name) { existing.eventName = ev.name; existing.filmTitle = ev.name; changed = true; }
      const mType = ev.media_type !== undefined ? ev.media_type : (ev.mediaType || '');
      if (existing.mediaType !== mType) { existing.mediaType = mType; changed = true; }
      if (ev.date && existing.eventDate !== ev.date) { existing.eventDate = ev.date; changed = true; }
      const sTime = ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '';
      if (sTime && existing.eventStartTime !== sTime) { existing.eventStartTime = sTime; changed = true; }
      if (ev.finishTime && existing.eventFinishTime !== ev.finishTime) { existing.eventFinishTime = ev.finishTime; changed = true; }
      if (ev.film_duration && existing.duration !== ev.film_duration) { existing.duration = ev.film_duration; changed = true; }
      if (ev.aspect_ratio && existing.aspectRatio !== ev.aspect_ratio) { existing.aspectRatio = ev.aspect_ratio; changed = true; }
      if (ev.sound_fader_level && existing.soundFaderLevel !== ev.sound_fader_level) { existing.soundFaderLevel = ev.sound_fader_level; changed = true; }
      if (ev.checks_completed !== undefined || ev.checksCompleted !== undefined) {
        const isPassed = !!(ev.checks_completed || ev.checksCompleted);
        if (isPassed && existing.qcStatus !== 'Passed') { existing.qcStatus = 'Passed'; changed = true; }
        if (existing.avCheck && isPassed) {
          existing.avCheck.maskingClean = true;
          existing.avCheck.dialogCenterAnchored = true;
          existing.avCheck.subtitleSync = true;
          changed = true;
        }
      }
      if (ev.dcp_qc_status && existing.qcStatus !== ev.dcp_qc_status) { existing.qcStatus = ev.dcp_qc_status; changed = true; }
      if (ev.dcp_received !== undefined || ev.dcpReceived !== undefined) {
        const isRcv = !!(ev.dcp_received || ev.dcpReceived);
        if (isRcv && existing.ingestStatus !== 'Pass') { existing.ingestStatus = 'Pass'; changed = true; }
      }
      if (ev.dcp_tester_user_id && existing.testedByUserId !== ev.dcp_tester_user_id) {
        existing.testedByUserId = ev.dcp_tester_user_id;
        existing.testedByUserName = userName(ev.dcp_tester_user_id);
        changed = true;
      }
      if (ev.dcp_test_datetime && existing.testDateTime !== ev.dcp_test_datetime) {
        existing.testDateTime = ev.dcp_test_datetime;
        changed = true;
      }
      if (ev.dcp_notes && existing.qcNotes !== ev.dcp_notes) {
        existing.qcNotes = ev.dcp_notes;
        changed = true;
      }
      if (changed) {
        existing.updatedAt = new Date().toISOString();
        store.upsert('dcps', existing);
      }
    } else {
      const safeSlug = (ev.name || 'Feature').replace(/[^A-Za-z0-9]/g, '');
      const dateCode = (ev.date || '20261023').replace(/-/g, '');
      const autoDci = `${safeSlug}_FTR-1_F_EN-XX_UK_51_2K_ST_${dateCode}_FAC_IOP_OV`;
      const newRec = {
        id: 'dcp-' + ev.id,
        eventId: ev.id,
        eventName: ev.name,
        filmTitle: ev.name,
        mediaType: ev.media_type || ev.mediaType || '',
        eventDate: ev.date || '',
        eventStartTime: ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '',
        eventFinishTime: ev.finishTime || '',
        dciTitle: ev.dci_title || ev.dciTitle || (media === 'DCP' ? autoDci : ''),
        cplUuid: ev.cpl_uuid || ev.cplUuid || (media === 'DCP' ? ('urn:uuid:' + store.uid('cpl') + '-dcp-cpl') : ''),
        contentType: 'Feature',
        duration: ev.film_duration || ev.filmDuration || '',
        screen: normalizedScreen,
        targetHardware: HARDWARE_MEDIA_BLOCKS[normalizedScreen] || (normalizedScreen + ' Media Block'),
        aspectRatio: ev.aspect_ratio || ev.aspectRatio || 'Flat (1.85:1)',
        resolution: '2K',
        frameRate: '24fps',
        audioFormat: '5.1',
        colorSpace: 'DCI-XYZ',
        colorNotes: '',
        ingestStatus: (ev.checks_completed || ev.checksCompleted) ? 'Pass' : ((ev.dcp_received || ev.dcpReceived) ? 'Pass' : 'Pending'),
        kdmRequired: (media === 'DCP'),
        kdmValidFrom: ev.date ? (ev.date + 'T08:00:00') : '',
        kdmValidTo: ev.date ? (ev.date + 'T23:59:00') : '',
        kdmTargetMatch: true,
        avCheck: {
          maskingClean: !!(ev.checks_completed || ev.checksCompleted),
          dialogCenterAnchored: !!(ev.checks_completed || ev.checksCompleted),
          subtitleSync: !!(ev.checks_completed || ev.checksCompleted)
        },
        creditOffset: ev.credit_offset || '',
        soundFaderLevel: ev.sound_fader_level || ev.soundFaderLevel || '7.0',
        qcStatus: (ev.checks_completed || ev.checksCompleted) ? 'Passed' : (ev.qc_status || 'Pending'),
        testedByUserId: ev.dcp_tester_user_id || ev.dcpTesterUserId || '',
        testedByUserName: userName(ev.dcp_tester_user_id || ev.dcpTesterUserId),
        testDateTime: ev.dcp_test_datetime || ev.dcpTestDatetime || '',
        qcNotes: (ev.dcp_notes || ev.techInfo || ev.notes || '').trim(),
        createdAt: ev.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.upsert('dcps', newRec);
    }
  }
  RMTP.syncAdvanceToDcp = syncAdvanceToDcp;
  RMTP.isCinemaSpace = isCinemaSpace;

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
          dciTitle: 'PastLives_FTR-1_F_EN-XX_UK_51_2K_A24_20261020_FAC_IOP_OV',
          cplUuid: 'urn:uuid:6b68e98c-8f4b-4b68-963b-61012b1d7d3b',
          contentType: 'Feature',
          duration: '01:46:12',
          screen: 'Screen One',
          targetHardware: HARDWARE_MEDIA_BLOCKS['Screen One'],
          aspectRatio: 'Flat (1.85:1)',
          resolution: '2K',
          frameRate: '24fps',
          audioFormat: '5.1',
          colorSpace: 'DCI-XYZ',
          colorNotes: 'DCI-XYZ verified. P3 color gamut accurate.',
          ingestStatus: 'Pass',
          kdmRequired: true,
          kdmValidFrom: '2026-10-20T08:00:00',
          kdmValidTo: '2026-10-28T23:59:00',
          kdmTargetMatch: true,
          avCheck: { maskingClean: true, dialogCenterAnchored: true, subtitleSync: true },
          creditOffset: '01:41:20',
          soundFaderLevel: '7.0',
          qcStatus: 'Passed',
          testedByUserId: 'user-3',
          testedByUserName: 'Sam Okafor',
          testDateTime: '2026-10-20T14:30:00',
          qcNotes: 'Crisp 2K flat framing. Centre channel anchor verified. Credit macro set at 01:41:20.',
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
          dciTitle: 'AnatomyOfAFall_FTR-2_S_FR-EN_UK_71_4K_PIC_20261022_FAC_SMPTE_OV',
          cplUuid: 'urn:uuid:a194bc02-38d1-419b-81d4-87428190de12',
          contentType: 'Feature',
          duration: '02:31:00',
          screen: 'Screen Two',
          targetHardware: HARDWARE_MEDIA_BLOCKS['Screen Two'],
          aspectRatio: 'Scope (2.39:1)',
          resolution: '4K',
          frameRate: '24fps',
          audioFormat: '7.1',
          colorSpace: 'DCI-XYZ',
          colorNotes: 'SMPTE DCP. English burnt-in & timed-text subs in sync.',
          ingestStatus: 'Pass',
          kdmRequired: true,
          kdmValidFrom: '2026-10-22T10:00:00',
          kdmValidTo: '2026-10-29T23:59:00',
          kdmTargetMatch: true,
          avCheck: { maskingClean: true, dialogCenterAnchored: true, subtitleSync: true },
          creditOffset: '02:26:45',
          soundFaderLevel: '6.8',
          qcStatus: 'Passed',
          testedByUserId: 'user-4',
          testedByUserName: 'Danny Cole',
          testDateTime: '2026-10-22T11:00:00',
          qcNotes: 'Scope lens macro triggered properly. Dialogue perfectly centered. House lights macro set.',
          createdAt: '2026-10-22T09:00:00Z',
          updatedAt: '2026-10-22T11:15:00Z'
        },
        {
          id: 'dcp-seed-03',
          eventId: '',
          eventName: 'East End Shorts Festival: Showcase Reel',
          filmTitle: 'East End Shorts Reel A',
          mediaType: 'DCP',
          eventDate: '2026-10-23',
          eventStartTime: '20:00',
          eventFinishTime: '21:30',
          dciTitle: 'EastEndShorts_SHR-1_F_EN-XX_UK_51_2K_IND_20261023_DVR_IOP_OV',
          cplUuid: 'urn:uuid:f0412891-92b8-4c81-8012-198428194a01',
          contentType: 'Short',
          duration: '01:18:40',
          screen: 'Screen Three',
          targetHardware: HARDWARE_MEDIA_BLOCKS['Screen Three'],
          aspectRatio: 'Flat (1.85:1)',
          resolution: '2K',
          frameRate: '25fps',
          audioFormat: '5.1',
          colorSpace: 'DCI-XYZ',
          colorNotes: 'Custom DaVinci Resolve export. Verified gamma curves, no 2.2/2.4 contrast wash.',
          ingestStatus: 'Pass',
          kdmRequired: false,
          kdmValidFrom: '',
          kdmValidTo: '',
          kdmTargetMatch: true,
          avCheck: { maskingClean: true, dialogCenterAnchored: true, subtitleSync: true },
          creditOffset: '01:16:10',
          soundFaderLevel: '6.5',
          qcStatus: 'Passed with Caveats',
          testedByUserId: 'user-3',
          testedByUserName: 'Sam Okafor',
          testDateTime: '2026-10-23T09:15:00',
          qcNotes: '25fps European frame rate. Note: Short 3 has slight audio level variance, keep fader at 6.5.',
          createdAt: '2026-10-23T08:00:00Z',
          updatedAt: '2026-10-23T09:30:00Z'
        }
      ];
      initialDcpSeeds.forEach(s => store.upsert('dcps', s));
      dcps = store.all('dcps');
    }

    allAdv.forEach(ev => {
      const isCinema = isCinemaSpace(ev.space);
      const isDcpCategory = (ev.category === 'Cinema' || ev.category === 'DCP Test');
      const media = ev.media_type || ev.mediaType || '';
      // Include ALL events taking place in cinema screens (Screen One, Screen Two, Screen Three)
      // or explicitly configured with cinema/DCP parameters
      const isScreenEvent = isCinema || isDcpCategory || media === 'DCP' || ev.dcp_received || ev.dcpReceived;

      if (!isScreenEvent) return;

      const existing = dcps.find(d => d.eventId === ev.id || d.id === 'dcp-' + ev.id);
      const screenName = Array.isArray(ev.space) ? ev.space[0] : (ev.space || 'Screen One');
      const normalizedScreen = screenName.indexOf('Screen') === -1 ? 'Screen One' : screenName;

      if (!existing) {
        const safeSlug = (ev.name || 'Feature').replace(/[^A-Za-z0-9]/g, '');
        const dateCode = (ev.date || '20261023').replace(/-/g, '');
        const autoDci = `${safeSlug}_FTR-1_F_EN-XX_UK_51_2K_ST_${dateCode}_FAC_IOP_OV`;

        const newRec = {
          id: 'dcp-' + ev.id,
          eventId: ev.id,
          eventName: ev.name,
          filmTitle: ev.name,
          mediaType: ev.media_type || ev.mediaType || '',
          eventDate: ev.date || '',
          eventStartTime: ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '',
          eventFinishTime: ev.finishTime || '',
          dciTitle: ev.dci_title || ev.dciTitle || (media === 'DCP' ? autoDci : ''),
          cplUuid: ev.cpl_uuid || ev.cplUuid || (media === 'DCP' ? ('urn:uuid:' + store.uid('cpl') + '-dcp-cpl') : ''),
          contentType: 'Feature',
          duration: ev.film_duration || ev.filmDuration || '',
          screen: normalizedScreen,
          targetHardware: HARDWARE_MEDIA_BLOCKS[normalizedScreen] || (normalizedScreen + ' Media Block'),
          aspectRatio: ev.aspect_ratio || ev.aspectRatio || 'Flat (1.85:1)',
          resolution: ev.resolution || '2K',
          frameRate: '24fps',
          audioFormat: ev.audio_format || '5.1',
          colorSpace: ev.color_space || 'DCI-XYZ',
          colorNotes: '',
          ingestStatus: (ev.checks_completed || ev.checksCompleted) ? 'Pass' : ((ev.dcp_received || ev.dcpReceived) ? 'Pass' : 'Pending'),
          kdmRequired: (media === 'DCP'),
          kdmValidFrom: ev.date ? (ev.date + 'T08:00:00') : '',
          kdmValidTo: ev.date ? (ev.date + 'T23:59:00') : '',
          kdmTargetMatch: true,
          avCheck: {
            maskingClean: !!(ev.checks_completed || ev.checksCompleted),
            dialogCenterAnchored: !!(ev.checks_completed || ev.checksCompleted),
            subtitleSync: !!(ev.checks_completed || ev.checksCompleted)
          },
          creditOffset: ev.credit_offset || '',
          soundFaderLevel: ev.sound_fader_level || ev.soundFaderLevel || '7.0',
          qcStatus: (ev.checks_completed || ev.checksCompleted) ? 'Passed' : (ev.qc_status || 'Pending'),
          testedByUserId: ev.dcp_tester_user_id || ev.dcpTesterUserId || '',
          testedByUserName: (ev.dcp_tester_user_id || ev.dcpTesterUserId) ? userName(ev.dcp_tester_user_id || ev.dcpTesterUserId) : '',
          testDateTime: ev.dcp_test_datetime || ev.dcpTestDatetime || '',
          qcNotes: (ev.dcp_notes || ev.techInfo || ev.notes || '').trim(),
          createdAt: ev.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        store.upsert('dcps', newRec);
        modified = true;
      } else {
        // Sync advance changes into existing tracker record
        let changed = false;
        if (existing.eventName !== ev.name) { existing.eventName = ev.name; changed = true; }
        if (!existing.filmTitle) { existing.filmTitle = ev.name; changed = true; }
        const mType = ev.media_type || ev.mediaType || '';
        if (existing.mediaType !== mType) {
          existing.mediaType = mType;
          changed = true;
        }
        if (ev.date && existing.eventDate !== ev.date) {
          existing.eventDate = ev.date;
          changed = true;
        }
        const sTime = ev.screening_starts_time || ev.screeningStartsTime || ev.startTime || '';
        if (sTime && existing.eventStartTime !== sTime) {
          existing.eventStartTime = sTime;
          changed = true;
        }
        if (ev.space && existing.screen !== normalizedScreen && !existing._manualScreen) {
          existing.screen = normalizedScreen;
          existing.targetHardware = HARDWARE_MEDIA_BLOCKS[normalizedScreen] || (normalizedScreen + ' Media Block');
          changed = true;
        }
        if (ev.film_duration && existing.duration !== ev.film_duration) {
          existing.duration = ev.film_duration;
          changed = true;
        }
        if (ev.aspect_ratio && existing.aspectRatio !== ev.aspect_ratio) {
          existing.aspectRatio = ev.aspect_ratio;
          changed = true;
        }
        if (ev.sound_fader_level && existing.soundFaderLevel !== ev.sound_fader_level) {
          existing.soundFaderLevel = ev.sound_fader_level;
          changed = true;
        }
        if (ev.dcp_tester_user_id && existing.testedByUserId !== ev.dcp_tester_user_id) {
          existing.testedByUserId = ev.dcp_tester_user_id;
          existing.testedByUserName = userName(ev.dcp_tester_user_id);
          changed = true;
        }
        if (ev.dcp_test_datetime && existing.testDateTime !== ev.dcp_test_datetime) {
          existing.testDateTime = ev.dcp_test_datetime;
          changed = true;
        }
        if (ev.dcp_notes && existing.qcNotes !== ev.dcp_notes) {
          existing.qcNotes = ev.dcp_notes;
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

  /* ---- DCI Naming Convention Parser ---- */
  function parseDciString(dci) {
    if (!dci || typeof dci !== 'string') return {};
    const parts = dci.trim().split('_');
    const result = {};
    if (parts.length >= 1) result.filmTitle = parts[0].replace(/([a-z])([A-Z])/g, '$1 $2');
    if (parts.length >= 2) {
      const typeCode = parts[1].split('-')[0].toUpperCase();
      if (typeCode === 'FTR') result.contentType = 'Feature';
      else if (typeCode === 'TLR') result.contentType = 'Trailer';
      else if (typeCode === 'ADV') result.contentType = 'Ad';
      else if (typeCode === 'SHR') result.contentType = 'Short';
      else if (typeCode === 'TSR') result.contentType = 'Teaser';
      else if (typeCode === 'PRO') result.contentType = 'Promo';
    }
    if (parts.length >= 3) {
      const aspect = parts[2].toUpperCase();
      if (aspect === 'F' || aspect.startsWith('F-')) result.aspectRatio = 'Flat (1.85:1)';
      else if (aspect === 'S' || aspect.startsWith('S-')) result.aspectRatio = 'Scope (2.39:1)';
    }
    if (parts.length >= 6) {
      const audio = parts[5].toUpperCase();
      if (audio === '51') result.audioFormat = '5.1';
      else if (audio === '71') result.audioFormat = '7.1';
      else if (audio.indexOf('ATMOS') > -1) result.audioFormat = 'Dolby Atmos';
      else if (audio === '20') result.audioFormat = 'Stereo (Lt/Rt)';
    }
    if (parts.length >= 7) {
      const res = parts[6].toUpperCase();
      if (res === '2K') result.resolution = '2K';
      else if (res === '4K') result.resolution = '4K';
    }
    return result;
  }

  /* ---- Filter State ---- */
  let activeScreenTab = 'all'; // 'all', 'Screen One', 'Screen Two', 'Screen Three'
  let activeQcFilter = 'all';   // 'all', 'Passed', 'Pending', 'Failed', 'Caveats'
  let activeIngestFilter = 'all';
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
    const passedCount = dcps.filter(d => d.qcStatus === 'Passed').length;
    const pendingQcCount = dcps.filter(d => d.qcStatus === 'Pending').length;
    const kdmAlerts = dcps.filter(d => {
      if (!d.kdmRequired) return false;
      if (!d.kdmTargetMatch) return true;
      if (!d.kdmValidTo) return true;
      const expiry = new Date(d.kdmValidTo).getTime();
      const now = Date.now();
      return expiry <= now || (expiry - now < 86400000 * 2); // expired or within 48h
    }).length;
    const ingestFailures = dcps.filter(d => d.ingestStatus === 'Fail' || d.ingestStatus === 'Corrupt Hash').length;

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

    if (activeQcFilter !== 'all') {
      filtered = filtered.filter(d => {
        if (activeQcFilter === 'Caveats') return d.qcStatus === 'Passed with Caveats';
        return d.qcStatus === activeQcFilter;
      });
    }
    if (activeIngestFilter !== 'all') {
      filtered = filtered.filter(d => d.ingestStatus === activeIngestFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      filtered = filtered.filter(d =>
        (d.filmTitle && d.filmTitle.toLowerCase().includes(q)) ||
        (d.dciTitle && d.dciTitle.toLowerCase().includes(q)) ||
        (d.cplUuid && d.cplUuid.toLowerCase().includes(q)) ||
        (d.screen && d.screen.toLowerCase().includes(q)) ||
        (d.eventName && d.eventName.toLowerCase().includes(q)) ||
        (d.mediaType && d.mediaType.toLowerCase().includes(q))
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
      const tA = a.testDateTime || a.kdmValidFrom || a.createdAt || '';
      const tB = b.testDateTime || b.kdmValidFrom || b.createdAt || '';
      return tB.localeCompare(tA);
    });

    el.innerHTML =
      '<div class="space-y-6 max-w-7xl mx-auto pb-16">' +
        // ---- Header Bar ----
        '<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-line">' +
          '<div>' +
            '<div class="flex items-center gap-2.5">' +
              '<h1 class="text-2xl font-bold font-display text-ink tracking-tight flex items-center gap-2">' +
                ui.icon('film', 'w-6 h-6 text-accent') +
                '<span>Cinema Technical QC & DCP Tracker</span>' +
              '</h1>' +
              '<span class="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-accent/15 text-accent border border-accent/30">Rich Mix Booth Tech</span>' +
            '</div>' +
            '<p class="text-xs text-muted mt-1">' +
              'Pre-screening technical verification across all screens (DCP, Laptop, Blu-Ray, HDMI), DCI naming strings, CPL UUIDs, KDM validity, and projection audio/visual sign-offs.' +
            '</p>' +
          '</div>' +
          '<div class="flex items-center gap-2.5 shrink-0 flex-wrap">' +
            '<button id="btn-sync-dcps" class="btn btn-ghost text-xs flex items-center gap-1.5" title="Re-sync with scheduled Cinema advances">' +
              ui.icon('refresh', 'w-4 h-4') + '<span>Sync Cinema Advances</span>' +
            '</button>' +
            '<button id="btn-add-dcp" class="btn btn-primary text-xs flex items-center gap-1.5 font-semibold shadow-2xs">' +
              ui.icon('plus', 'w-4 h-4') + '<span>Ingest New Screening</span>' +
            '</button>' +
          '</div>' +
        '</div>' +

        // ---- KPI Metrics Strip (Anti-slop clean tabular figures) ----
        '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' +
          '<div class="p-3.5 rounded-xl bg-panel border border-line">' +
            '<div class="text-[11px] font-mono uppercase tracking-wider text-muted">Screenings Ingested</div>' +
            '<div class="text-2xl font-bold font-mono text-ink mt-1 tabular-nums">' + totalCount + '</div>' +
            '<div class="text-[11px] text-muted mt-1">' + upcomingCount + ' upcoming \u00b7 ' + pastCount + ' past</div>' +
          '</div>' +

          '<div class="p-3.5 rounded-xl bg-panel border border-line">' +
            '<div class="text-[11px] font-mono uppercase tracking-wider text-ok">QC Passed / Ready</div>' +
            '<div class="text-2xl font-bold font-mono text-ok mt-1 tabular-nums">' + passedCount + '</div>' +
            '<div class="text-[11px] text-muted mt-1">' + pendingQcCount + ' pending technician check</div>' +
          '</div>' +

          '<div class="p-3.5 rounded-xl bg-panel border ' + (kdmAlerts ? 'border-amber-500/40 bg-amber-500/5' : 'border-line') + '">' +
            '<div class="text-[11px] font-mono uppercase tracking-wider ' + (kdmAlerts ? 'text-amber-400 font-bold' : 'text-muted') + '">KDM Attention Required</div>' +
            '<div class="text-2xl font-bold font-mono ' + (kdmAlerts ? 'text-amber-400' : 'text-ink') + ' mt-1 tabular-nums">' + kdmAlerts + '</div>' +
            '<div class="text-[11px] text-muted mt-1">' + (kdmAlerts ? 'Expiring, unassigned, or key alert' : 'All KDMs valid & matched') + '</div>' +
          '</div>' +

          '<div class="p-3.5 rounded-xl bg-panel border ' + (ingestFailures ? 'border-danger/50 bg-danger/5' : 'border-line') + '">' +
            '<div class="text-[11px] font-mono uppercase tracking-wider ' + (ingestFailures ? 'text-danger font-bold' : 'text-muted') + '">Hash & Ingest Errors</div>' +
            '<div class="text-2xl font-bold font-mono ' + (ingestFailures ? 'text-danger' : 'text-ink') + ' mt-1 tabular-nums">' + ingestFailures + '</div>' +
            '<div class="text-[11px] text-muted mt-1">' + (ingestFailures ? 'Corrupted files requiring redelivery' : 'Zero package corruption') + '</div>' +
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
              '<input type="text" id="dcp-search-input" value="' + ui.esc(searchTerm) + '" placeholder="Search title, CPL UUID, media type..." class="field !py-1.5 !pl-8 !text-xs !bg-panel w-full" />' +
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

            '<div class="flex items-center gap-3 shrink-0">' +
              '<label class="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-muted hover:text-ink select-none">' +
                '<input type="checkbox" id="chk-exclude-past" class="w-3.5 h-3.5 rounded accent-[var(--accent)]" ' + (excludePast ? 'checked' : '') + ' />' +
                '<span>Exclude Past Screenings</span>' +
              '</label>' +
              '<div class="h-4 w-px bg-line/80 hidden sm:block"></div>' +
              '<div class="flex items-center gap-1.5">' +
                '<select id="filter-qc-status" class="field !py-1 !text-xs !bg-panel border-line text-ink font-medium">' +
                  '<option value="all"' + (activeQcFilter === 'all' ? ' selected' : '') + '>All QC</option>' +
                  '<option value="Passed"' + (activeQcFilter === 'Passed' ? ' selected' : '') + '>Passed</option>' +
                  '<option value="Pending"' + (activeQcFilter === 'Pending' ? ' selected' : '') + '>Pending</option>' +
                  '<option value="Caveats"' + (activeQcFilter === 'Caveats' ? ' selected' : '') + '>Caveats</option>' +
                  '<option value="Failed"' + (activeQcFilter === 'Failed' ? ' selected' : '') + '>Failed</option>' +
                '</select>' +
                '<select id="filter-ingest-status" class="field !py-1 !text-xs !bg-panel border-line text-ink font-medium">' +
                  '<option value="all"' + (activeIngestFilter === 'all' ? ' selected' : '') + '>All Ingest</option>' +
                  '<option value="Pass"' + (activeIngestFilter === 'Pass' ? ' selected' : '') + '>Pass</option>' +
                  '<option value="Pending"' + (activeIngestFilter === 'Pending' ? ' selected' : '') + '>Ingesting</option>' +
                  '<option value="Corrupt Hash"' + (activeIngestFilter === 'Corrupt Hash' ? ' selected' : '') + '>Corrupt</option>' +
                  '<option value="Fail"' + (activeIngestFilter === 'Fail' ? ' selected' : '') + '>Fail</option>' +
                '</select>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Informational banner when past screenings are excluded
          (activeDateFilter === 'upcoming' && pastCount > 0 ? (
            '<div class="flex items-center justify-between text-xs px-3.5 py-1.5 rounded-lg bg-panel border border-line text-muted">' +
              '<div class="flex items-center gap-1.5">' +
                ui.icon('clock', 'w-3.5 h-3.5 text-accent') +
                '<span>Showing <strong>' + filtered.length + '</strong> active screening' + (filtered.length === 1 ? '' : 's') + ' \u00b7 <strong>' + pastCount + '</strong> past screening' + (pastCount === 1 ? '' : 's') + ' excluded from today\u2019s booth queue.</span>' +
              '</div>' +
              '<button type="button" data-date-tab="past" class="text-accent hover:underline font-semibold text-[11px] flex items-center gap-1">' +
                '<span>View Past Screenings</span> \u2192' +
              '</button>' +
            '</div>'
          ) : '') +
        '</div>' +

        // ---- High-Density DCP & Cinema Table View ----
        (filtered.length ? (
          '<div class="border border-line rounded-xl bg-panel overflow-hidden shadow-2xs">' +
            '<div class="overflow-x-auto">' +
              '<table class="w-full text-left text-xs border-collapse">' +
                '<thead>' +
                  '<tr class="border-b border-line bg-panel2/60 text-muted font-mono uppercase text-[10px] tracking-wider select-none">' +
                    '<th class="py-3 px-3.5 min-w-[155px]">Media Type &amp; Date</th>' +
                    '<th class="py-3 px-3.5">Film / DCI Naming String</th>' +
                    '<th class="py-3 px-3">Type &amp; Dur</th>' +
                    '<th class="py-3 px-3">Screen &amp; Server</th>' +
                    '<th class="py-3 px-3">Technical Specs</th>' +
                    '<th class="py-3 px-3">KDM Window &amp; Cert</th>' +
                    '<th class="py-3 px-3">QC Sign-off</th>' +
                    '<th class="py-3 px-3 text-right">Actions</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody class="divide-y divide-line/60">' +
                  filtered.map(dcp => renderDcpRow(dcp)).join('') +
                '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>'
        ) : (
          '<div class="p-12 text-center rounded-xl border border-line bg-panel">' +
            '<div class="w-12 h-12 rounded-full bg-panel2 flex items-center justify-center text-muted mx-auto mb-3">' +
              ui.icon('film', 'w-6 h-6 text-accent') +
            '</div>' +
            '<div class="font-display font-semibold text-ink text-base">No screenings match your current filter</div>' +
            '<p class="text-xs text-muted mt-1 max-w-md mx-auto">' +
              (activeDateFilter === 'upcoming' && pastCount > 0 ?
                'All current records are past screenings. Click below to view the Past Archive.' :
                'Try adjusting your screen filter or search query, or ingest a new screening.') +
            '</p>' +
            '<div class="mt-4 flex items-center justify-center gap-2">' +
              (activeDateFilter === 'upcoming' && pastCount > 0 ? (
                '<button type="button" data-date-tab="all" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5">' +
                  ui.icon('clock', 'w-4 h-4') + '<span>Show All Screenings (' + totalCount + ')</span>' +
                '</button>'
              ) : (
                '<button id="btn-empty-add-dcp" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5">' +
                  ui.icon('plus', 'w-4 h-4') + '<span>Ingest New Screening</span>' +
                '</button>'
              )) +
              (searchTerm || activeScreenTab !== 'all' || activeQcFilter !== 'all' || activeDateFilter !== 'upcoming' ? (
                '<button id="btn-reset-filters" class="btn btn-ghost text-xs">Reset All Filters</button>'
              ) : '') +
            '</div>' +
          '</div>'
        )) +
      '</div>';

    wireEvents();
  }

  function renderDcpRow(dcp) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const isPast = dcp.eventDate && dcp.eventDate < todayIso;
    const mediaTypes = RMTP.MEDIA_TYPES || ['DCP', 'Laptop via HDMI', 'Blu-Ray', 'HDMI (Other)'];
    const isScope = dcp.aspectRatio && dcp.aspectRatio.indexOf('Scope') > -1;
    const is4K = dcp.resolution === '4K';
    const isDcp = dcp.mediaType === 'DCP' || dcp.kdmRequired;

    // QC Status badge
    let qcBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-panel2 text-muted border border-line">Pending QC</span>';
    if (dcp.qcStatus === 'Passed') {
      qcBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-ok/15 text-ok border border-ok/30">' + ui.icon('check', 'w-3 h-3') + 'QC PASSED</span>';
    } else if (dcp.qcStatus === 'Passed with Caveats') {
      qcBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-warning/15 text-warning border border-warning/30">PASS W/ CAVEATS</span>';
    } else if (dcp.qcStatus === 'Failed') {
      qcBadge = '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-danger/15 text-danger border border-danger/30">' + ui.icon('x', 'w-3 h-3') + 'QC FAILED</span>';
    }

    // Ingest Status badge
    let ingestBadge = '<span class="text-ok font-semibold">Pass</span>';
    if (dcp.ingestStatus === 'Corrupt Hash') {
      ingestBadge = '<span class="text-danger font-bold uppercase tracking-wider bg-danger/10 px-1 rounded">Corrupt Hash</span>';
    } else if (dcp.ingestStatus === 'Fail') {
      ingestBadge = '<span class="text-danger font-semibold">Failed</span>';
    } else if (dcp.ingestStatus === 'Ingesting') {
      ingestBadge = '<span class="text-info font-semibold animate-pulse">Ingesting...</span>';
    } else if (dcp.ingestStatus === 'Pending') {
      ingestBadge = '<span class="text-muted font-medium">Pending Ingest</span>';
    }

    // KDM Status
    let kdmHtml = '<span class="text-muted italic">No Key Needed (Open)</span>';
    if (dcp.kdmRequired) {
      if (dcp.kdmValidTo) {
        const toDate = new Date(dcp.kdmValidTo);
        const fromDate = dcp.kdmValidFrom ? new Date(dcp.kdmValidFrom) : null;
        const now = Date.now();
        const isExpired = toDate.getTime() < now;
        const isPreWindow = fromDate && fromDate.getTime() > now;
        const dateStr = toDate.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        if (isExpired) {
          kdmHtml = '<div class="text-danger font-bold flex items-center gap-1">' + ui.icon('alert', 'w-3 h-3') + '<span>EXPIRED (' + dateStr + ')</span></div>';
        } else if (isPreWindow) {
          kdmHtml = '<div class="text-warning font-semibold">Starts ' + fromDate.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' }) + '</div>';
        } else {
          kdmHtml = '<div class="text-ok font-medium font-mono text-[11px]">Valid until ' + dateStr + '</div>';
        }
      } else {
        kdmHtml = '<span class="text-amber-400 font-medium">KDM Required \u00b7 TBC</span>';
      }

      kdmHtml += '<div class="flex items-center gap-1 text-[10px] mt-0.5 ' + (dcp.kdmTargetMatch ? 'text-muted' : 'text-danger font-semibold') + '">' +
        (dcp.kdmTargetMatch ? ui.icon('check', 'w-3 h-3 text-ok') + 'Cert Matches Server' : ui.icon('alert', 'w-3 h-3 text-danger') + 'CERT MISMATCH ALERT') +
      '</div>';
    } else if (dcp.mediaType && dcp.mediaType !== 'DCP') {
      kdmHtml = '<span class="text-muted text-[11px]">' + ui.esc(dcp.mediaType) + ' (N/A)</span>';
    }

    // Content Type styling
    const cType = dcp.contentType || 'Feature';
    let typeClass = 'bg-info/10 text-info border-info/20';
    if (cType === 'Feature') typeClass = 'bg-accent/15 text-accent border-accent/30 font-semibold';
    else if (cType === 'Trailer') typeClass = 'bg-purple-500/15 text-purple-300 border-purple-500/30';
    else if (cType === 'Short') typeClass = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

    const shortUuid = dcp.cplUuid ? (dcp.cplUuid.length > 28 ? dcp.cplUuid.substring(0, 28) + '\u2026' : dcp.cplUuid) : 'No CPL UUID';

    return (
      '<tr class="hover:bg-panel2/30 transition-colors group ' + (isPast ? 'opacity-85' : '') + '">' +
        // 1. Media Type & Screening Date (Dropdown as first column with Advance options)
        '<td class="py-3 px-3.5 align-top min-w-[155px]">' +
          '<div class="mb-1.5">' +
            '<select data-dcp-media-select="' + dcp.id + '" class="field !py-1 !px-2 !text-xs font-semibold bg-panel border-line text-ink w-full shadow-2xs" title="Select screening media type (syncs bidirectional with Advance)">' +
              '<option value="">\u2014 Blank \u2014</option>' +
              mediaTypes.map(m =>
                '<option value="' + m + '"' + (dcp.mediaType === m ? ' selected' : '') + '>' + m + '</option>'
              ).join('') +
            '</select>' +
          '</div>' +
          '<div class="flex items-center gap-1.5 font-mono text-[11px] text-muted">' +
            ui.icon('calendar', 'w-3 h-3 text-muted shrink-0') +
            '<span>' + ui.esc(dcp.eventDate || 'Date TBC') + '</span>' +
            (dcp.eventStartTime ? '<span class="text-ink font-semibold">' + ui.esc(dcp.eventStartTime) + '</span>' : '') +
          '</div>' +
          (isPast ? '<span class="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-panel2 text-muted border border-line">Past Screening</span>' : '') +
        '</td>' +

        // 2. Film & DCI Naming String
        '<td class="py-3 px-3.5 align-top max-w-[280px] min-w-[220px]">' +
          '<div class="font-display font-semibold text-ink text-sm group-hover:text-accent transition-colors truncate" title="' + ui.esc(dcp.filmTitle || dcp.eventName || 'Film') + '">' +
            ui.esc(dcp.filmTitle || dcp.eventName || 'Film') +
          '</div>' +
          '<div class="font-mono text-[11px] text-muted truncate mt-0.5 select-all" title="' + ui.esc(dcp.dciTitle || '') + '">' +
            ui.esc(dcp.dciTitle || (isDcp ? 'No DCI convention name provided' : 'Non-DCP package / live screening')) +
          '</div>' +
          '<div class="flex items-center gap-1.5 mt-1">' +
            '<span class="font-mono text-[10px] text-muted/80 bg-panel2 px-1.5 py-0.5 rounded border border-line truncate select-all" title="' + ui.esc(dcp.cplUuid || '') + '">' +
              ui.esc(shortUuid) +
            '</span>' +
            (dcp.cplUuid ? '<button type="button" data-copy-cpl="' + ui.esc(dcp.cplUuid) + '" class="text-muted hover:text-ink" title="Copy full CPL UUID">' + ui.icon('copy', 'w-3 h-3') + '</button>' : '') +
          '</div>' +
        '</td>' +

        // 3. Type & Duration
        '<td class="py-3 px-3 align-top whitespace-nowrap">' +
          '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono border ' + typeClass + ' mb-1">' +
            ui.esc(cType) +
          '</span>' +
          '<div class="font-mono text-xs font-semibold text-ink tabular-nums">' + ui.esc(dcp.duration || '\u2014') + '</div>' +
          '<div class="font-mono text-[10px] text-muted">' + ui.esc(dcp.frameRate || '24fps') + '</div>' +
        '</td>' +

        // 4. Screen & Target Hardware
        '<td class="py-3 px-3 align-top min-w-[150px]">' +
          '<div class="font-semibold text-ink flex items-center gap-1">' +
            ui.icon('pin', 'w-3 h-3 text-accent') +
            '<span>' + ui.esc(dcp.screen || 'Screen One') + '</span>' +
          '</div>' +
          '<div class="text-[10px] text-muted leading-tight mt-0.5">' +
            ui.esc((dcp.targetHardware || '').replace(/Screen (One|Two|Three) \u2014 /, '')) +
          '</div>' +
          '<div class="text-[10px] mt-1">' +
            '<span class="text-muted">Ingest: </span>' + ingestBadge +
          '</div>' +
        '</td>' +

        // 5. Technical Specs
        '<td class="py-3 px-3 align-top whitespace-nowrap">' +
          '<div class="flex items-center gap-1.5 mb-1">' +
            '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ' +
              (isScope ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' : 'bg-sky-500/20 text-sky-300 border border-sky-500/40') + '">' +
              (isScope ? 'Scope (2.39:1)' : 'Flat (1.85:1)') +
            '</span>' +
            '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-panel2 text-ink border border-line">' +
              (is4K ? '4K' : '2K') +
            '</span>' +
          '</div>' +
          '<div class="text-[11px] text-muted flex items-center gap-1">' +
            ui.icon('tool', 'w-3 h-3 text-muted') +
            '<span>Audio: <strong>' + ui.esc(dcp.audioFormat || '5.1') + '</strong></span>' +
            (dcp.soundFaderLevel ? '<span class="text-ink font-mono font-semibold ml-1">Fader ' + ui.esc(dcp.soundFaderLevel) + '</span>' : '') +
          '</div>' +
          '<div class="text-[10px] font-mono text-muted/90 mt-0.5">' +
            'Color: <strong>' + ui.esc(dcp.colorSpace || 'DCI-XYZ') + '</strong>' +
          '</div>' +
        '</td>' +

        // 6. KDM Window & Cert Match
        '<td class="py-3 px-3 align-top min-w-[160px]">' +
          kdmHtml +
        '</td>' +

        // 7. QC Sign-off & Lights
        '<td class="py-3 px-3 align-top min-w-[160px]">' +
          '<div class="mb-1">' + qcBadge + '</div>' +
          (dcp.creditOffset ? '<div class="text-[10px] font-mono text-ink">Credits: <strong>' + ui.esc(dcp.creditOffset) + '</strong></div>' : '<div class="text-[10px] font-mono text-muted">Credits: Not set</div>') +
          '<div class="text-[10px] text-muted truncate mt-0.5">' +
            (dcp.testedByUserName ? 'By ' + ui.esc(dcp.testedByUserName) : 'Untested') +
          '</div>' +
        '</td>' +

        // 8. Actions
        '<td class="py-3 px-3 align-top text-right whitespace-nowrap">' +
          '<div class="flex items-center justify-end gap-1">' +
            '<button type="button" data-qc-dcp="' + dcp.id + '" class="btn btn-primary !py-1 !px-2.5 text-xs font-semibold flex items-center gap-1 shadow-2xs" title="Open Full Technical QC Console">' +
              ui.icon('check', 'w-3.5 h-3.5') + '<span>QC Sign-off</span>' +
            '</button>' +
            '<button type="button" data-edit-dcp="' + dcp.id + '" class="btn btn-ghost !p-1.5 text-muted hover:text-ink rounded-lg" title="Edit Metadata">' +
              ui.icon('pen', 'w-3.5 h-3.5') +
            '</button>' +
            '<button type="button" data-delete-dcp="' + dcp.id + '" class="btn btn-danger !p-1.5 rounded-lg" title="Delete Screening Record">' +
              ui.icon('trash', 'w-3.5 h-3.5') +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>'
    );
  }

  /* ---- QC Inspection & Edit Modal ---- */
  function openDcpModal(dcp = null) {
    const isNew = !dcp;
    const item = dcp ? JSON.parse(JSON.stringify(dcp)) : {
      id: 'dcp-manual-' + store.uid('dcp'),
      eventId: '',
      eventName: '',
      filmTitle: '',
      dciTitle: '',
      cplUuid: 'urn:uuid:' + store.uid('cpl') + '-dcp-playlist',
      contentType: 'Feature',
      duration: '01:50:00',
      screen: activeScreenTab !== 'all' ? activeScreenTab : 'Screen One',
      targetHardware: HARDWARE_MEDIA_BLOCKS[activeScreenTab !== 'all' ? activeScreenTab : 'Screen One'],
      aspectRatio: 'Flat (1.85:1)',
      resolution: '2K',
      frameRate: '24fps',
      audioFormat: '5.1',
      colorSpace: 'DCI-XYZ',
      colorNotes: '',
      ingestStatus: 'Pass',
      kdmRequired: true,
      kdmValidFrom: new Date().toISOString().slice(0, 10) + 'T08:00:00',
      kdmValidTo: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10) + 'T23:59:00',
      kdmTargetMatch: true,
      avCheck: { maskingClean: true, dialogCenterAnchored: true, subtitleSync: true },
      creditOffset: '',
      soundFaderLevel: '7.0',
      qcStatus: 'Pending',
      testedByUserId: auth.current() ? auth.current().id : '',
      testedByUserName: auth.current() ? auth.displayName(auth.current()) : '',
      testDateTime: new Date().toISOString().slice(0, 16),
      qcNotes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const users = store.all('users');
    const userOptions = users.map(u =>
      '<option value="' + u.id + '"' + (item.testedByUserId === u.id ? ' selected' : '') + '>' + ui.esc(auth.displayName(u)) + ' (' + ui.esc(u.position || u.role) + ')</option>'
    ).join('');

    const modalBody =
      '<div class="space-y-6 text-xs max-h-[75vh] overflow-y-auto pr-1">' +
        // Panel 1: Core Metadata & Identification
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center justify-between">' +
            '<span class="flex items-center gap-1.5">' + ui.icon('film', 'w-3.5 h-3.5') + 'Core Metadata & DCI Naming</span>' +
            '<button type="button" id="btn-parse-dci" class="text-accent hover:underline font-semibold cursor-pointer text-[11px] flex items-center gap-1">' +
              ui.icon('tool', 'w-3 h-3') + '<span>Auto-Parse DCI String</span>' +
            '</button>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Media Type</label>' +
              '<select id="m-media-type" class="field !text-xs w-full font-semibold">' +
                '<option value="">\u2014 Blank \u2014</option>' +
                (RMTP.MEDIA_TYPES || ['DCP', 'Laptop via HDMI', 'Blu-Ray', 'HDMI (Other)']).map(m =>
                  '<option value="' + m + '"' + (item.mediaType === m ? ' selected' : '') + '>' + m + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Film / Screening Title *</label>' +
              '<input type="text" id="m-film-title" value="' + ui.esc(item.filmTitle || item.eventName || '') + '" placeholder="e.g. Past Lives" class="field !text-xs w-full font-semibold text-ink" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Content Type</label>' +
              '<select id="m-content-type" class="field !text-xs w-full">' +
                ['Feature', 'Trailer', 'Ad', 'Short', 'Test Reel', 'Promo'].map(t =>
                  '<option value="' + t + '"' + (item.contentType === t ? ' selected' : '') + '>' + t + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          '<div>' +
            '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">DCI Naming Convention String</label>' +
            '<input type="text" id="m-dci-title" value="' + ui.esc(item.dciTitle || '') + '" placeholder="e.g. Movie_FTR-1_F_EN-XX_UK_51_2K_ST_20261023_FAC_IOP_OV" class="field !text-xs w-full font-mono text-ink" />' +
            '<div class="text-[10px] text-muted mt-1">Full composition playlist naming convention string matching the distributor release.</div>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<div class="flex items-center justify-between mb-1">' +
                '<label class="text-[11px] font-semibold text-muted uppercase tracking-wider">CPL UUID (Composition Playlist)</label>' +
                '<button type="button" id="btn-gen-cpl" class="text-accent hover:underline text-[10px] font-mono">Regen UUID</button>' +
              '</div>' +
              '<input type="text" id="m-cpl-uuid" value="' + ui.esc(item.cplUuid || '') + '" placeholder="urn:uuid:6b68e98c-..." class="field !text-xs w-full font-mono select-all" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Exact Duration (HH:MM:SS)</label>' +
              '<input type="text" id="m-duration" value="' + ui.esc(item.duration || '01:45:00') + '" placeholder="01:45:00" class="field !text-xs w-full font-mono tabular-nums" />' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Panel 2: Technical Specifications & Macros
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center gap-1.5">' +
            ui.icon('sliders', 'w-3.5 h-3.5') + '<span>Technical Specifications & Projection Macros</span>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Target Screen / Space</label>' +
              '<select id="m-screen" class="field !text-xs w-full font-semibold">' +
                ['Screen One', 'Screen Two', 'Screen Three'].map(sp =>
                  '<option value="' + sp + '"' + (item.screen === sp ? ' selected' : '') + '>' + sp + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Target Media Block / Server</label>' +
              '<input type="text" id="m-hardware" value="' + ui.esc(item.targetHardware || HARDWARE_MEDIA_BLOCKS['Screen One']) + '" class="field !text-xs w-full font-mono text-muted" />' +
            '</div>' +
          '</div>' +

          '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Aspect Ratio</label>' +
              '<select id="m-aspect" class="field !text-xs w-full font-semibold">' +
                '<option value="Flat (1.85:1)"' + (item.aspectRatio && item.aspectRatio.indexOf('Flat') > -1 ? ' selected' : '') + '>Flat (1.85:1)</option>' +
                '<option value="Scope (2.39:1)"' + (item.aspectRatio && item.aspectRatio.indexOf('Scope') > -1 ? ' selected' : '') + '>Scope (2.39:1)</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Resolution</label>' +
              '<select id="m-res" class="field !text-xs w-full">' +
                '<option value="2K"' + (item.resolution === '2K' ? ' selected' : '') + '>2K (2048 \u00d7 1080)</option>' +
                '<option value="4K"' + (item.resolution === '4K' ? ' selected' : '') + '>4K (4096 \u00d7 2160)</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Frame Rate</label>' +
              '<select id="m-framerate" class="field !text-xs w-full font-mono">' +
                ['24fps', '25fps', '48fps (HFR)', '30fps', '60fps'].map(f =>
                  '<option value="' + f + '"' + (item.frameRate === f ? ' selected' : '') + '>' + f + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Audio Format</label>' +
              '<select id="m-audio" class="field !text-xs w-full font-semibold">' +
                ['5.1', '7.1', 'Dolby Atmos', 'Stereo (Lt/Rt)'].map(a =>
                  '<option value="' + a + '"' + (item.audioFormat === a ? ' selected' : '') + '>' + a + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-line/60">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Color Space & Gamma</label>' +
              '<select id="m-color-space" class="field !text-xs w-full font-mono">' +
                ['DCI-XYZ', 'Rec.709', 'sRGB'].map(c =>
                  '<option value="' + c + '"' + (item.colorSpace === c ? ' selected' : '') + '>' + c + '</option>'
                ).join('') +
              '</select>' +
              '<div class="mt-2">' +
                '<label class="flex items-center gap-2 cursor-pointer">' +
                  '<input type="checkbox" id="m-davinci-gamma" class="w-4 h-4 rounded accent-[var(--accent)]" ' + (item.colorNotes ? 'checked' : '') + ' />' +
                  '<span class="text-[11px] text-muted">DaVinci Resolve Gamma Checked (no 2.2/2.4 shift)</span>' +
                '</label>' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Fader Reference Level</label>' +
              '<input type="text" id="m-fader" value="' + ui.esc(item.soundFaderLevel || '7.0') + '" placeholder="e.g. 7.0, 6.8" class="field !text-xs w-full font-mono" />' +
              '<div class="text-[10px] text-muted mt-1">Standard Dolby reference is 7.0 (85dBc dialogue).</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Panel 3: KDM & Server Management
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center gap-1.5">' +
            ui.icon('lock', 'w-3.5 h-3.5') + '<span>KDM & Server Ingest Management</span>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Package Ingest Status</label>' +
              '<select id="m-ingest-status" class="field !text-xs w-full font-semibold">' +
                ['Pass', 'Ingesting', 'Fail', 'Corrupt Hash'].map(s =>
                  '<option value="' + s + '"' + (item.ingestStatus === s ? ' selected' : '') + '>' + s + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
            '<div class="flex items-center pt-5">' +
              '<label class="flex items-center gap-2 cursor-pointer select-none">' +
                '<input type="checkbox" id="m-kdm-required" class="w-4 h-4 rounded accent-[var(--accent)]" ' + (item.kdmRequired ? 'checked' : '') + ' />' +
                '<span class="text-xs font-semibold text-ink">Encrypted Package (KDM Required)</span>' +
              '</label>' +
            '</div>' +
          '</div>' +

          '<div id="kdm-fields-wrap" class="' + (item.kdmRequired ? '' : 'hidden') + ' space-y-3 pt-1 border-t border-line/60">' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
              '<div>' +
                '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">KDM Valid From</label>' +
                '<input type="datetime-local" id="m-kdm-from" value="' + ui.esc(item.kdmValidFrom ? item.kdmValidFrom.slice(0, 16) : '') + '" class="field !text-xs w-full font-mono" />' +
              '</div>' +
              '<div>' +
                '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">KDM Valid To (Expiry)</label>' +
                '<input type="datetime-local" id="m-kdm-to" value="' + ui.esc(item.kdmValidTo ? item.kdmValidTo.slice(0, 16) : '') + '" class="field !text-xs w-full font-mono" />' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<label class="flex items-center gap-2 cursor-pointer select-none p-2 rounded-lg bg-panel border border-line">' +
                '<input type="checkbox" id="m-kdm-target-match" class="w-4 h-4 rounded accent-ok" ' + (item.kdmTargetMatch ? 'checked' : '') + ' />' +
                '<div>' +
                  '<span class="text-xs font-bold text-ink block">KDM Target Server Hardware Certificate Match</span>' +
                  '<span class="text-[10px] text-muted">Confirmed that the KDM target server recipient cert matches this media block serial number.</span>' +
                '</div>' +
              '</label>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Panel 4: Quality Control (QC) Sign-off
        '<div class="p-4 rounded-xl bg-panel2/40 border border-line space-y-3.5">' +
          '<div class="eyebrow text-accent flex items-center gap-1.5">' +
            ui.icon('check', 'w-3.5 h-3.5') + '<span>Quality Control (QC) & Lighting Sign-off</span>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">' +
            '<label class="flex items-start gap-2 p-2.5 rounded-lg bg-panel border border-line cursor-pointer select-none">' +
              '<input type="checkbox" id="qc-masking" class="mt-0.5 w-4 h-4 rounded accent-ok" ' + (item.avCheck && item.avCheck.maskingClean ? 'checked' : '') + ' />' +
              '<div>' +
                '<span class="font-semibold text-ink block">Visual Masking Clean</span>' +
                '<span class="text-[10px] text-muted">No spill onto side/top borders. Lens macro verified.</span>' +
              '</div>' +
            '</label>' +

            '<label class="flex items-start gap-2 p-2.5 rounded-lg bg-panel border border-line cursor-pointer select-none">' +
              '<input type="checkbox" id="qc-dialog" class="mt-0.5 w-4 h-4 rounded accent-ok" ' + (item.avCheck && item.avCheck.dialogCenterAnchored ? 'checked' : '') + ' />' +
              '<div>' +
                '<span class="font-semibold text-ink block">Center Channel Dialogue</span>' +
                '<span class="text-[10px] text-muted">Dialogue anchored strictly to center horn. No bleed.</span>' +
              '</div>' +
            '</label>' +

            '<label class="flex items-start gap-2 p-2.5 rounded-lg bg-panel border border-line cursor-pointer select-none">' +
              '<input type="checkbox" id="qc-subs" class="mt-0.5 w-4 h-4 rounded accent-ok" ' + (item.avCheck && item.avCheck.subtitleSync ? 'checked' : '') + ' />' +
              '<div>' +
                '<span class="font-semibold text-ink block">Subtitle Sync & Font</span>' +
                '<span class="text-[10px] text-muted">Timed-text XML rendered accurately with zero lag.</span>' +
              '</div>' +
            '</label>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Credit Offset Timecode (House Lights Macro)</label>' +
              '<input type="text" id="m-credit-offset" value="' + ui.esc(item.creditOffset || '') + '" placeholder="e.g. 01:48:15" class="field !text-xs w-full font-mono" />' +
              '<div class="text-[10px] text-muted mt-1">Triggers auditorium lighting cue to rise at start of end credits.</div>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Overall QC Approval Status *</label>' +
              '<select id="m-qc-status" class="field !text-xs w-full font-bold">' +
                ['Pending', 'Passed', 'Passed with Caveats', 'Failed'].map(st =>
                  '<option value="' + st + '"' + (item.qcStatus === st ? ' selected' : '') + '>' + st + '</option>'
                ).join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Testing Technician</label>' +
              '<select id="m-tester" class="field !text-xs w-full">' +
                '<option value="">\u25cb Select Projectionist / Tech\u2026</option>' +
                userOptions +
              '</select>' +
            '</div>' +
            '<div>' +
              '<div class="flex items-center justify-between mb-1">' +
                '<label class="text-[11px] font-semibold text-muted uppercase tracking-wider">Test Date & Time</label>' +
                '<button type="button" id="btn-test-now" class="text-accent hover:underline text-[10px] font-semibold">Set to Now</button>' +
              '</div>' +
              '<input type="datetime-local" id="m-test-date" value="' + ui.esc(item.testDateTime ? item.testDateTime.slice(0, 16) : '') + '" class="field !text-xs w-full font-mono" />' +
            '</div>' +
          '</div>' +

          '<div>' +
            '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Technical QC Notes & Observations</label>' +
            '<textarea id="m-qc-notes" rows="2" class="field !text-xs w-full font-mono" placeholder="Note framing macro adjustments, fader levels, audio quirks, DaVinci Resolve gamma verification...">' + ui.esc(item.qcNotes || '') + '</textarea>' +
          '</div>' +
        '</div>' +
      '</div>';

    const m = ui.modal({
      title: isNew ? 'Ingest New Digital Cinema Package (DCP)' : 'Technical QC Inspection & Sign-off',
      size: 'max-w-2xl',
      body: modalBody,
      footer:
        '<div class="flex items-center justify-between w-full gap-2">' +
          '<button type="button" class="btn btn-ghost" data-cancel>Cancel</button>' +
          '<div class="flex items-center gap-2">' +
            (!isNew ? '<button type="button" id="btn-quick-pass" class="btn btn-ghost text-ok font-semibold border border-ok/30 bg-ok/5 hover:bg-ok/10">1-Click Pass QC</button>' : '') +
            '<button type="button" id="btn-save-dcp" class="btn btn-primary font-semibold flex items-center gap-1.5 shadow-2xs">' +
              ui.icon('check', 'w-4 h-4') + '<span>' + (isNew ? 'Create DCP Record' : 'Save QC Sign-off') + '</span>' +
            '</button>' +
          '</div>' +
        '</div>'
    });

    // Wire Modal Interactions
    const screenSel = m.root.querySelector('#m-screen');
    const hardwareInput = m.root.querySelector('#m-hardware');
    if (screenSel && hardwareInput) {
      screenSel.addEventListener('change', () => {
        const val = screenSel.value;
        if (HARDWARE_MEDIA_BLOCKS[val]) hardwareInput.value = HARDWARE_MEDIA_BLOCKS[val];
      });
    }

    const kdmRequiredCb = m.root.querySelector('#m-kdm-required');
    const kdmFieldsWrap = m.root.querySelector('#kdm-fields-wrap');
    if (kdmRequiredCb && kdmFieldsWrap) {
      kdmRequiredCb.addEventListener('change', () => {
        kdmFieldsWrap.classList.toggle('hidden', !kdmRequiredCb.checked);
      });
    }

    const btnParseDci = m.root.querySelector('#btn-parse-dci');
    if (btnParseDci) {
      btnParseDci.addEventListener('click', () => {
        const dciVal = m.root.querySelector('#m-dci-title')?.value || '';
        if (!dciVal) {
          ui.toast('Enter a DCI string first to auto-parse', 'warning');
          return;
        }
        const parsed = parseDciString(dciVal);
        if (parsed.filmTitle && !m.root.querySelector('#m-film-title').value) {
          m.root.querySelector('#m-film-title').value = parsed.filmTitle;
        }
        if (parsed.contentType) m.root.querySelector('#m-content-type').value = parsed.contentType;
        if (parsed.aspectRatio) m.root.querySelector('#m-aspect').value = parsed.aspectRatio;
        if (parsed.resolution) m.root.querySelector('#m-res').value = parsed.resolution;
        if (parsed.audioFormat) m.root.querySelector('#m-audio').value = parsed.audioFormat;
        ui.toast('Auto-parsed DCI metadata successfully', 'ok');
      });
    }

    const btnGenCpl = m.root.querySelector('#btn-gen-cpl');
    if (btnGenCpl) {
      btnGenCpl.addEventListener('click', () => {
        const uuidInput = m.root.querySelector('#m-cpl-uuid');
        if (uuidInput) {
          uuidInput.value = 'urn:uuid:' + store.uid('cpl') + '-dcp-' + Math.random().toString(36).substring(2, 8);
          ui.toast('Generated new CPL UUID', 'info');
        }
      });
    }

    const btnTestNow = m.root.querySelector('#btn-test-now');
    if (btnTestNow) {
      btnTestNow.addEventListener('click', () => {
        const testDateInput = m.root.querySelector('#m-test-date');
        if (testDateInput) {
          testDateInput.value = new Date().toISOString().slice(0, 16);
        }
      });
    }

    const btnQuickPass = m.root.querySelector('#btn-quick-pass');
    if (btnQuickPass) {
      btnQuickPass.addEventListener('click', () => {
        m.root.querySelector('#m-qc-status').value = 'Passed';
        m.root.querySelector('#qc-masking').checked = true;
        m.root.querySelector('#qc-dialog').checked = true;
        m.root.querySelector('#qc-subs').checked = true;
        m.root.querySelector('#m-kdm-target-match').checked = true;
        m.root.querySelector('#m-ingest-status').value = 'Pass';
        if (!m.root.querySelector('#m-tester').value && auth.current()) {
          m.root.querySelector('#m-tester').value = auth.current().id;
        }
        if (!m.root.querySelector('#m-test-date').value) {
          m.root.querySelector('#m-test-date').value = new Date().toISOString().slice(0, 16);
        }
        ui.toast('Marked all checks as PASSED', 'ok');
      });
    }

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);

    const btnSave = m.root.querySelector('#btn-save-dcp');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        const titleVal = m.root.querySelector('#m-film-title')?.value.trim();
        if (!titleVal) {
          ui.toast('Film Title is required', 'danger');
          m.root.querySelector('#m-film-title')?.focus();
          return;
        }

        const testerId = m.root.querySelector('#m-tester')?.value || '';
        const testerUser = testerId ? store.find('users', testerId) : null;

        item.mediaType = m.root.querySelector('#m-media-type')?.value || '';
        item.filmTitle = titleVal;
        item.eventName = item.eventName || titleVal;
        item.dciTitle = m.root.querySelector('#m-dci-title')?.value.trim() || item.dciTitle;
        item.cplUuid = m.root.querySelector('#m-cpl-uuid')?.value.trim() || item.cplUuid;
        item.contentType = m.root.querySelector('#m-content-type')?.value || 'Feature';
        item.duration = m.root.querySelector('#m-duration')?.value.trim() || item.duration;
        item.screen = m.root.querySelector('#m-screen')?.value || 'Screen One';
        item.targetHardware = m.root.querySelector('#m-hardware')?.value.trim() || HARDWARE_MEDIA_BLOCKS[item.screen];
        item.aspectRatio = m.root.querySelector('#m-aspect')?.value || 'Flat (1.85:1)';
        item.resolution = m.root.querySelector('#m-res')?.value || '2K';
        item.frameRate = m.root.querySelector('#m-framerate')?.value || '24fps';
        item.audioFormat = m.root.querySelector('#m-audio')?.value || '5.1';
        item.colorSpace = m.root.querySelector('#m-color-space')?.value || 'DCI-XYZ';
        item.colorNotes = m.root.querySelector('#m-davinci-gamma')?.checked ? 'DaVinci Resolve verified.' : '';
        item.soundFaderLevel = m.root.querySelector('#m-fader')?.value.trim() || '7.0';

        item.ingestStatus = m.root.querySelector('#m-ingest-status')?.value || 'Pass';
        item.kdmRequired = m.root.querySelector('#m-kdm-required')?.checked || false;
        item.kdmValidFrom = m.root.querySelector('#m-kdm-from')?.value || '';
        item.kdmValidTo = m.root.querySelector('#m-kdm-to')?.value || '';
        item.kdmTargetMatch = m.root.querySelector('#m-kdm-target-match')?.checked || false;

        item.avCheck = {
          maskingClean: m.root.querySelector('#qc-masking')?.checked || false,
          dialogCenterAnchored: m.root.querySelector('#qc-dialog')?.checked || false,
          subtitleSync: m.root.querySelector('#qc-subs')?.checked || false
        };
        item.creditOffset = m.root.querySelector('#m-credit-offset')?.value.trim() || '';
        item.qcStatus = m.root.querySelector('#m-qc-status')?.value || 'Pending';
        item.testedByUserId = testerId;
        item.testedByUserName = testerUser ? auth.displayName(testerUser) : '';
        item.testDateTime = m.root.querySelector('#m-test-date')?.value || '';
        item.qcNotes = m.root.querySelector('#m-qc-notes')?.value.trim() || '';
        item.updatedAt = new Date().toISOString();

        store.upsert('dcps', item);

        // Bi-directional bridge: immediately reflect changes in Event Advances
        syncDcpToAdvance(item);

        ui.toast('Saved screening specifications and QC sign-off', 'ok');
        m.close();
        renderView();
      });
    }
  }

  function wireEvents() {
    // Screen filter tabs
    el.querySelectorAll('[data-screen-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeScreenTab = btn.getAttribute('data-screen-tab');
        renderView();
      });
    });

    // Date filter tabs (Upcoming & Today vs All vs Past Archive)
    el.querySelectorAll('[data-date-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeDateFilter = btn.getAttribute('data-date-tab');
        excludePast = (activeDateFilter === 'upcoming');
        renderView();
      });
    });

    // Exclude past screenings checkbox
    const chkExclude = el.querySelector('#chk-exclude-past');
    if (chkExclude) {
      chkExclude.addEventListener('change', () => {
        excludePast = chkExclude.checked;
        activeDateFilter = excludePast ? 'upcoming' : 'all';
        renderView();
      });
    }

    // Media type dropdown on table row (bi-directional sync with advance)
    el.querySelectorAll('[data-dcp-media-select]').forEach(sel => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-dcp-media-select');
        const val = sel.value;
        const dcp = store.find('dcps', id);
        if (dcp) {
          dcp.mediaType = val;
          if (val === 'DCP' && dcp.kdmRequired === undefined) {
            dcp.kdmRequired = true;
          }
          dcp.updatedAt = new Date().toISOString();
          store.upsert('dcps', dcp);
          syncDcpToAdvance(dcp);
          ui.toast('Updated Media Type to ' + (val || 'Blank') + ' & synced to Advance', 'ok');
          renderView();
        }
      });
    });

    // QC Status dropdown
    const qcSel = el.querySelector('#filter-qc-status');
    if (qcSel) {
      qcSel.addEventListener('change', () => {
        activeQcFilter = qcSel.value;
        renderView();
      });
    }

    // Ingest Status dropdown
    const ingestSel = el.querySelector('#filter-ingest-status');
    if (ingestSel) {
      ingestSel.addEventListener('change', () => {
        activeIngestFilter = ingestSel.value;
        renderView();
      });
    }

    // Search input
    const searchInp = el.querySelector('#dcp-search-input');
    if (searchInp) {
      searchInp.addEventListener('input', () => {
        searchTerm = searchInp.value;
        renderView();
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
        activeQcFilter = 'all';
        activeIngestFilter = 'all';
        activeDateFilter = 'upcoming';
        excludePast = true;
        searchTerm = '';
        renderView();
      });
    }

    // Sync button
    const btnSync = el.querySelector('#btn-sync-dcps');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        syncAdvancingToDcps();
        ui.toast('Synchronized cinema advances with DCP registry', 'ok');
        renderView();
      });
    }

    // Add DCP buttons
    const btnAdd = el.querySelector('#btn-add-dcp');
    if (btnAdd) btnAdd.addEventListener('click', () => openDcpModal());

    const btnEmptyAdd = el.querySelector('#btn-empty-add-dcp');
    if (btnEmptyAdd) btnEmptyAdd.addEventListener('click', () => openDcpModal());

    // Row Actions
    el.querySelectorAll('[data-qc-dcp]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = b.getAttribute('data-qc-dcp');
        const dcp = store.find('dcps', id);
        if (dcp) openDcpModal(dcp);
      });
    });

    el.querySelectorAll('[data-edit-dcp]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = b.getAttribute('data-edit-dcp');
        const dcp = store.find('dcps', id);
        if (dcp) openDcpModal(dcp);
      });
    });

    el.querySelectorAll('[data-delete-dcp]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = b.getAttribute('data-delete-dcp');
        const dcp = store.find('dcps', id);
        if (!dcp) return;
        const ok = await ui.confirm('Remove package \u201c' + (dcp.filmTitle || 'DCP') + '\u201d from the registry?', {
          title: 'Delete Screening Record',
          danger: true,
          confirmLabel: 'Remove'
        });
        if (ok) {
          store.remove('dcps', id);
          ui.toast('Removed screening record', 'ok');
          renderView();
        }
      });
    });

    // Copy CPL UUID
    el.querySelectorAll('[data-copy-cpl]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const uuid = b.getAttribute('data-copy-cpl');
        if (uuid && navigator.clipboard) {
          navigator.clipboard.writeText(uuid).then(() => {
            ui.toast('Copied CPL UUID to clipboard', 'ok');
          }).catch(() => {
            ui.toast('UUID: ' + uuid, 'info');
          });
        }
      });
    });
  }

  // Initial render
  renderView();

  // If a specific DCP ID was passed in query e.g. #/dcp?id=dcp-123, open its modal automatically
  if (query && query.id) {
    const allDcps = store.all('dcps') || [];
    const target = allDcps.find(d => d.id === query.id || d.eventId === query.id || ('dcp-' + d.eventId) === query.id);
    if (target) {
      setTimeout(() => openDcpModal(target), 100);
    }
  }
};
