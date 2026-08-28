/* ============================================================
   dmx.js — DMX Lighting Fixture Personalities & Patch Management
   ------------------------------------------------------------
   Provides:
   1. Reusable Fixture Personalities Library (Factory Presets + Custom)
   2. Real-time DMX Universe Collision & Overlap Detection
   3. Auto-calculated Start / End DMX Addresses
   4. Patch Sheet CSV Export & Print Helpers
   ============================================================ */
RMTP.dmx = (function () {
  const store = RMTP.store;
  const ui = RMTP.ui;

  /* ---- Factory Built-in Fixture Personalities ---- */
  const FACTORY_PERSONALITIES = [
    {
      id: 'fix-robe-spiider-27',
      manufacturer: 'Robe',
      model: 'Spiider',
      mode: 'Mode 1 (Standard Wash/Beam)',
      channels: 27,
      category: 'Moving Wash / Beam',
      isFactory: true
    },
    {
      id: 'fix-robe-spiider-49',
      manufacturer: 'Robe',
      model: 'Spiider',
      mode: 'Mode 2 (Enhanced FX)',
      channels: 49,
      category: 'Moving Wash / Beam',
      isFactory: true
    },
    {
      id: 'fix-robe-pointe-16',
      manufacturer: 'Robe',
      model: 'Pointe',
      mode: 'Mode 1 (Standard Beam/Spot)',
      channels: 16,
      category: 'Moving Beam / Spot',
      isFactory: true
    },
    {
      id: 'fix-robe-pointe-24',
      manufacturer: 'Robe',
      model: 'Pointe',
      mode: 'Mode 2 (Extended)',
      channels: 24,
      category: 'Moving Beam / Spot',
      isFactory: true
    },
    {
      id: 'fix-chauvet-mav-force-s',
      manufacturer: 'Chauvet Professional',
      model: 'Maverick Force S Spot',
      mode: 'Standard (24ch)',
      channels: 24,
      category: 'Moving Spot / Profile',
      isFactory: true
    },
    {
      id: 'fix-chauvet-colorado-1-quad-12',
      manufacturer: 'Chauvet Professional',
      model: 'COLORado 1-Quad Zoom',
      mode: 'TOUR (12ch)',
      channels: 12,
      category: 'LED Par / Wash',
      isFactory: true
    },
    {
      id: 'fix-chauvet-colorado-1-quad-7',
      manufacturer: 'Chauvet Professional',
      model: 'COLORado 1-Quad Zoom',
      mode: 'ARC.2 (7ch)',
      channels: 7,
      category: 'LED Par / Wash',
      isFactory: true
    },
    {
      id: 'fix-etc-s4-led-s3-10',
      manufacturer: 'ETC',
      model: 'Source Four LED Series 3',
      mode: 'Lustr X8 Direct (10ch)',
      channels: 10,
      category: 'Profile / Leko',
      isFactory: true
    },
    {
      id: 'fix-etc-s4-led-s2-8',
      manufacturer: 'ETC',
      model: 'Source Four LED Series 2',
      mode: 'Lustr Direct (8ch)',
      channels: 8,
      category: 'Profile / Leko',
      isFactory: true
    },
    {
      id: 'fix-astera-titan-4',
      manufacturer: 'Astera',
      model: 'Titan Tube (FP1)',
      mode: 'RGB CCT Dim 8-bit (4ch)',
      channels: 4,
      category: 'Battery / Wireless Pixel Tube',
      isFactory: true
    },
    {
      id: 'fix-astera-titan-16px',
      manufacturer: 'Astera',
      model: 'Titan Tube (FP1)',
      mode: '16 Pixels RGB (48ch)',
      channels: 48,
      category: 'Battery / Wireless Pixel Tube',
      isFactory: true
    },
    {
      id: 'fix-martin-mac-aura-xb-14',
      manufacturer: 'Martin',
      model: 'MAC Aura XB',
      mode: 'Standard Mode (14ch)',
      channels: 14,
      category: 'Moving Wash',
      isFactory: true
    },
    {
      id: 'fix-martin-mac-quantum-prof-27',
      manufacturer: 'Martin',
      model: 'MAC Quantum Profile',
      mode: 'Extended Mode (27ch)',
      channels: 27,
      category: 'Moving Profile',
      isFactory: true
    },
    {
      id: 'fix-claypaky-mythos2-30',
      manufacturer: 'Clay Paky',
      model: 'Mythos 2',
      mode: 'Standard (30ch)',
      channels: 30,
      category: 'Moving Hybrid Beam/Spot',
      isFactory: true
    },
    {
      id: 'fix-chauvet-intimidator-375z',
      manufacturer: 'Chauvet DJ',
      model: 'Intimidator Spot 375Z',
      mode: '15 Channel Mode',
      channels: 15,
      category: 'Moving Spot',
      isFactory: true
    },
    {
      id: 'fix-generic-dimmer-1',
      manufacturer: 'Generic',
      model: 'Dimmer / Conventional',
      mode: '1 Channel (0-100% Intensity)',
      channels: 1,
      category: 'Conventional / Tungsten',
      isFactory: true
    },
    {
      id: 'fix-generic-rgbw-4',
      manufacturer: 'Generic',
      model: 'LED Par RGBW',
      mode: '4 Channel (R/G/B/W)',
      channels: 4,
      category: 'LED Par / Wash',
      isFactory: true
    },
    {
      id: 'fix-generic-rgbwa-uv-6',
      manufacturer: 'Generic',
      model: 'LED Par RGBWA+UV',
      mode: '6 Channel (R/G/B/W/A/UV)',
      channels: 6,
      category: 'LED Par / Wash',
      isFactory: true
    },
    {
      id: 'fix-showtec-sunstrip-10',
      manufacturer: 'Showtec',
      model: 'Sunstrip Active DMX',
      mode: '10 Channel (Individual Cell)',
      channels: 10,
      category: 'Batten / Blinder',
      isFactory: true
    },
    {
      id: 'fix-look-unique-hazer-2',
      manufacturer: 'Look Solutions',
      model: 'Unique 2.1 Hazer',
      mode: '2 Channel (Pump / Fan)',
      channels: 2,
      category: 'Atmospheric / FX',
      isFactory: true
    },
    {
      id: 'fix-look-viper-smoke-1',
      manufacturer: 'Look Solutions',
      model: 'Viper NT Fogger',
      mode: '1 Channel (Pump)',
      channels: 1,
      category: 'Atmospheric / FX',
      isFactory: true
    }
  ];

  const STANDARD_LOCATIONS = [
    'LX1 (Downstage Truss)',
    'LX2 (Midstage Truss)',
    'LX3 (Upstage Truss)',
    'FOH Front of House Truss',
    'FOH Advanced Bar',
    'Stage Floor SL',
    'Stage Floor SR',
    'Stage Floor USC',
    'Stage Left Boom 1',
    'Stage Left Boom 2',
    'Stage Right Boom 1',
    'Stage Right Boom 2',
    'Auditorium High Side Left',
    'Auditorium High Side Right',
    'Touring Ground Package'
  ];

  /* ---- Personalities Store Operations ---- */
  function getAllPersonalities() {
    const custom = (store && typeof store.all === 'function') ? store.all('dmx_personalities') : [];
    const list = Array.isArray(custom) ? custom.slice() : [];
    // Combine factory personalities with custom (custom can override or supplement)
    const combined = FACTORY_PERSONALITIES.slice();
    list.forEach((c) => {
      const idx = combined.findIndex((p) => p.id === c.id);
      if (idx > -1) {
        combined[idx] = c;
      } else {
        combined.push(c);
      }
    });
    return combined;
  }

  function getPersonality(id) {
    if (!id) return null;
    return getAllPersonalities().find((p) => p.id === id) || null;
  }

  function savePersonality(pers) {
    if (!pers) return null;
    const id = pers.id || 'pers-' + Math.random().toString(36).slice(2, 9);
    const item = Object.assign({}, pers, {
      id: id,
      channels: Math.max(1, parseInt(pers.channels, 10) || 1),
      manufacturer: (pers.manufacturer || '').trim() || 'Generic',
      model: (pers.model || '').trim() || 'Custom Fixture',
      mode: (pers.mode || '').trim() || 'Standard',
      category: (pers.category || '').trim() || 'Fixtures',
      isFactory: !!pers.isFactory,
      notes: pers.notes || '',
      createdAt: pers.createdAt || Date.now(),
      updatedAt: Date.now()
    });

    if (store && typeof store.upsert === 'function') {
      store.upsert('dmx_personalities', item);
    }
    return item;
  }

  function deletePersonality(id) {
    if (!id) return;
    if (store && typeof store.remove === 'function') {
      store.remove('dmx_personalities', id);
    }
  }

  /* ---- DMX Lighting Patches Store Operations ---- */
  function getAllPatches() {
    return (store && typeof store.all === 'function') ? store.all('dmx_patches') : [];
  }

  function getPatch(id) {
    if (!id) return null;
    return (store && typeof store.find === 'function') ? store.find('dmx_patches', id) : null;
  }

  function savePatch(patch) {
    if (!patch) return null;
    const id = patch.id || 'dmx-patch-' + Math.random().toString(36).slice(2, 9);
    const item = Object.assign({}, patch, {
      id: id,
      title: (patch.title || patch.name || 'DMX Lighting Patch').trim(),
      eventId: patch.eventId || null,
      eventName: patch.eventName || '',
      space: patch.space || '',
      date: patch.date || '',
      notes: patch.notes || '',
      fixtures: Array.isArray(patch.fixtures) ? patch.fixtures : [],
      createdAt: patch.createdAt || Date.now(),
      updatedAt: Date.now()
    });

    if (store && typeof store.upsert === 'function') {
      store.upsert('dmx_patches', item);
    }
    return item;
  }

  function deletePatch(id) {
    if (!id) return;
    if (store && typeof store.remove === 'function') {
      store.remove('dmx_patches', id);
    }
  }

  /* ---- Address Calculation & Collision Validation ---- */
  function getEndAddress(startAddress, channels) {
    const s = parseInt(startAddress, 10) || 1;
    const c = Math.max(1, parseInt(channels, 10) || 1);
    return s + c - 1;
  }

  function formatDmxAddress(universe, address, endAddress) {
    const u = parseInt(universe, 10) || 1;
    const start = parseInt(address, 10) || 1;
    const end = endAddress ? parseInt(endAddress, 10) : start;
    if (start === end) {
      return u + '.' + String(start).padStart(3, '0');
    }
    return u + '.' + String(start).padStart(3, '0') + ' \u2013 ' + u + '.' + String(end).padStart(3, '0');
  }

  /**
   * Evaluates patch list for:
   * 1. Direct address overlap within the same Universe
   * 2. Out of bounds addresses (> 512 or < 1)
   */
  function validatePatch(fixtures) {
    const list = Array.isArray(fixtures) ? fixtures : [];
    const conflictMap = {}; // fixtureId -> array of conflict strings
    const collisionPairs = [];
    const outOfBounds = [];
    const universeStats = {}; // univ -> { count, totalChannels, maxAddress }

    list.forEach((fix, idx) => {
      const fixId = fix.id || 'fix-' + idx;
      const univ = parseInt(fix.universe, 10) || 1;
      const start = parseInt(fix.address, 10) || 1;
      const chCount = Math.max(1, parseInt(fix.channels, 10) || 1);
      const end = start + chCount - 1;

      if (!universeStats[univ]) {
        universeStats[univ] = { universe: univ, count: 0, totalChannels: 0, highestAddress: 0 };
      }
      universeStats[univ].count++;
      universeStats[univ].totalChannels += chCount;
      if (end > universeStats[univ].highestAddress) {
        universeStats[univ].highestAddress = end;
      }

      if (start < 1 || start > 512 || end > 512) {
        outOfBounds.push({
          fixtureId: fixId,
          unit: fix.unit || (idx + 1),
          universe: univ,
          start: start,
          end: end,
          message: 'DMX address ' + start + (end !== start ? '–' + end : '') + ' exceeds Universe ' + univ + ' (1–512 limits)!'
        });
        conflictMap[fixId] = conflictMap[fixId] || [];
        conflictMap[fixId].push('Exceeds 512 DMX limit in Universe ' + univ);
      }
    });

    // Check collisions among pairs in same universe
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const aId = a.id || 'fix-' + i;
      const aUniv = parseInt(a.universe, 10) || 1;
      const aStart = parseInt(a.address, 10) || 1;
      const aCount = Math.max(1, parseInt(a.channels, 10) || 1);
      const aEnd = aStart + aCount - 1;
      const aUnit = a.unit || (i + 1);
      const aName = a.name || a.model || 'Fixture #' + aUnit;

      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const bId = b.id || 'fix-' + j;
        const bUniv = parseInt(b.universe, 10) || 1;
        if (aUniv !== bUniv) continue;

        const bStart = parseInt(b.address, 10) || 1;
        const bCount = Math.max(1, parseInt(b.channels, 10) || 1);
        const bEnd = bStart + bCount - 1;
        const bUnit = b.unit || (j + 1);
        const bName = b.name || b.model || 'Fixture #' + bUnit;

        // Check if ranges overlap: [aStart, aEnd] and [bStart, bEnd]
        if (aStart <= bEnd && aEnd >= bStart) {
          const overlapStart = Math.max(aStart, bStart);
          const overlapEnd = Math.min(aEnd, bEnd);
          const msg = 'Universe ' + aUniv + ': Overlaps with #' + bUnit + ' (' + bName + ') on Ch ' + overlapStart + (overlapStart !== overlapEnd ? '–' + overlapEnd : '');
          
          conflictMap[aId] = conflictMap[aId] || [];
          conflictMap[aId].push(msg);

          conflictMap[bId] = conflictMap[bId] || [];
          conflictMap[bId].push('Universe ' + aUniv + ': Overlaps with #' + aUnit + ' (' + aName + ') on Ch ' + overlapStart + (overlapStart !== overlapEnd ? '–' + overlapEnd : ''));

          collisionPairs.push({
            universe: aUniv,
            fixtureA: { id: aId, unit: aUnit, name: aName, start: aStart, end: aEnd },
            fixtureB: { id: bId, unit: bUnit, name: bName, start: bStart, end: bEnd },
            overlapRange: overlapStart + (overlapStart !== overlapEnd ? '–' + overlapEnd : '')
          });
        }
      }
    }

    const hasCollisions = collisionPairs.length > 0;
    const hasErrors = hasCollisions || outOfBounds.length > 0;

    return {
      hasErrors,
      hasCollisions,
      collisionPairs,
      outOfBounds,
      conflictMap,
      universeStats
    };
  }

  /* Auto-calculate sequential DMX addresses for an array of fixtures */
  function autoAddressSequential(fixtures, startingUniverse, startingAddress) {
    let currentUniv = Math.max(1, parseInt(startingUniverse, 10) || 1);
    let currentAddr = Math.max(1, parseInt(startingAddress, 10) || 1);

    return fixtures.map((fix) => {
      const ch = Math.max(1, parseInt(fix.channels, 10) || 1);
      // If fixture won't fit in current universe (512 limit), wrap to next universe address 1
      if (currentAddr + ch - 1 > 512) {
        currentUniv++;
        currentAddr = 1;
      }
      const start = currentAddr;
      const end = start + ch - 1;
      currentAddr += ch;

      return Object.assign({}, fix, {
        universe: currentUniv,
        address: start,
        endAddress: end
      });
    });
  }

  /* ---- CSV Generation & Download ---- */
  function exportCsv(fixtures, eventName, spaceName) {
    const list = Array.isArray(fixtures) ? fixtures : [];
    const validation = validatePatch(list);

    const headers = [
      'Universe',
      'Start Address',
      'End Address',
      'Channels',
      'Fixture # / Unit',
      'Hanging Location / Truss',
      'Custom Name / Purpose',
      'Manufacturer',
      'Model / Fixture Type',
      'Mode / Profile',
      'Conflict Status',
      'Notes'
    ];

    const rows = list.map((fix, idx) => {
      const fixId = fix.id || 'fix-' + idx;
      const univ = parseInt(fix.universe, 10) || 1;
      const addr = parseInt(fix.address, 10) || 1;
      const ch = Math.max(1, parseInt(fix.channels, 10) || 1);
      const end = addr + ch - 1;
      const conflicts = (validation.conflictMap[fixId] || []).join('; ');

      return [
        univ,
        addr,
        end,
        ch,
        fix.unit !== undefined && fix.unit !== '' ? fix.unit : (idx + 1),
        fix.location || '',
        fix.name || fix.model || '',
        fix.manufacturer || '',
        fix.model || '',
        fix.mode || '',
        conflicts ? 'CONFLICT: ' + conflicts : 'OK',
        fix.notes || ''
      ].map((val) => '"' + String(val).replace(/"/g, '""') + '"');
    });

    const csvContent = [headers.join(',')].concat(rows.map((r) => r.join(','))).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const cleanTitle = (eventName || 'lighting-patch').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    link.setAttribute('href', url);
    link.setAttribute('download', cleanTitle + '-dmx-patch.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    ui.toast('Exported DMX Patch Sheet as CSV', 'ok');
  }

  /* ---- Modal for Creating / Editing Fixture Personality ---- */
  function openPersonalityModal(persOrNull, onSaved) {
    const isEdit = !!(persOrNull && persOrNull.id);
    const pers = persOrNull || {};

    const CATEGORIES = [
      'Moving Spot / Profile',
      'Moving Wash / Beam',
      'Moving Hybrid Beam/Spot',
      'LED Par / Wash',
      'Profile / Leko',
      'Conventional / Tungsten',
      'Battery / Wireless Pixel Tube',
      'Batten / Blinder',
      'Strobe / FX',
      'Atmospheric / FX',
      'Other Fixture'
    ];

    const m = ui.modal({
      title: isEdit ? 'Edit Fixture Personality' : 'Add Reusable Fixture Personality',
      size: 'md:max-w-lg',
      body:
        '<form id="form-fixture-personality" class="grid gap-4 text-xs">' +
          '<div class="grid sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">Manufacturer *</label>' +
              '<input id="p-manu" class="field font-medium" value="' + ui.esc(pers.manufacturer || '') + '" placeholder="e.g. Robe, Chauvet, ETC" required />' +
            '</div>' +
            '<div>' +
              '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">Model Name *</label>' +
              '<input id="p-model" class="field font-semibold text-accent" value="' + ui.esc(pers.model || '') + '" placeholder="e.g. Spiider, Force S" required />' +
            '</div>' +
          '</div>' +

          '<div class="grid sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">Mode / Profile Name</label>' +
              '<input id="p-mode" class="field" value="' + ui.esc(pers.mode || 'Standard') + '" placeholder="e.g. Mode 1 (Standard 24ch)" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">DMX Channel Count *</label>' +
              '<input id="p-channels" type="number" min="1" max="512" class="field font-mono font-bold text-accent" value="' + (pers.channels || 1) + '" required />' +
            '</div>' +
          '</div>' +

          '<div>' +
            '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">Category</label>' +
            '<select id="p-category" class="field">' +
              CATEGORIES.map((cat) => '<option value="' + ui.esc(cat) + '" ' + (cat === pers.category ? 'selected' : '') + '>' + ui.esc(cat) + '</option>').join('') +
            '</select>' +
          '</div>' +

          '<div>' +
            '<label class="block text-xs font-semibold text-ink uppercase tracking-wider mb-1">Notes / Features (Optional)</label>' +
            '<textarea id="p-notes" class="field" rows="2" placeholder="e.g. Zoom 4-50 deg, Flower effect, requires 16-bit pan/tilt...">' + ui.esc(pers.notes || '') + '</textarea>' +
          '</div>' +

          '<div class="flex items-center justify-between pt-2 border-t border-line/60">' +
            (isEdit && !pers.isFactory ? (
              '<button type="button" id="btn-delete-personality" class="btn btn-danger text-xs flex items-center gap-1">' +
                ui.icon('trash', 'w-3.5 h-3.5') + '<span>Delete</span>' +
              '</button>'
            ) : '<div></div>') +
            '<div class="flex items-center gap-2">' +
              '<button type="button" class="btn btn-ghost text-xs" data-close-modal>Cancel</button>' +
              '<button type="submit" class="btn btn-primary text-xs font-semibold flex items-center gap-1">' +
                ui.icon('check', 'w-3.5 h-3.5') + '<span>' + (isEdit ? 'Save Personality' : 'Create Personality') + '</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</form>'
    });

    const form = m.root.querySelector('#form-fixture-personality');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const manu = form.querySelector('#p-manu').value.trim();
        const model = form.querySelector('#p-model').value.trim();
        const mode = form.querySelector('#p-mode').value.trim() || 'Standard';
        const channels = Math.max(1, parseInt(form.querySelector('#p-channels').value, 10) || 1);
        const category = form.querySelector('#p-category').value;
        const notes = form.querySelector('#p-notes').value.trim();

        if (!manu || !model) {
          ui.toast('Manufacturer and Model are required', 'danger');
          return;
        }

        const saved = savePersonality({
          id: pers.id || null,
          manufacturer: manu,
          model: model,
          mode: mode,
          channels: channels,
          category: category,
          notes: notes,
          isFactory: false
        });

        ui.toast('Fixture personality saved: ' + manu + ' ' + model, 'ok');
        m.close();
        if (typeof onSaved === 'function') onSaved(saved);
      });
    }

    const delBtn = m.root.querySelector('#btn-delete-personality');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (confirm('Delete fixture personality "' + pers.manufacturer + ' ' + pers.model + '"?')) {
          deletePersonality(pers.id);
          ui.toast('Personality deleted', 'ok');
          m.close();
          if (typeof onSaved === 'function') onSaved(null);
        }
      });
    }
  }

  /* ---- Modal to Manage All Fixture Personalities ---- */
  function openPersonalitiesManagerModal(onSelectedOrSaved) {
    function renderManager() {
      const all = getAllPersonalities();

      const m = ui.modal({
        title: 'Fixture Personalities Library',
        size: 'md:max-w-2xl',
        body:
          '<div class="grid gap-4 text-xs">' +
            '<div class="flex items-center justify-between gap-2 pb-2 border-b border-line/60">' +
              '<div>' +
                '<div class="text-xs font-semibold text-ink">Standard & Custom Personalities</div>' +
                '<div class="text-[11px] text-muted">Manage fixture models, channel counts and default profiles for rapid patching.</div>' +
              '</div>' +
              '<button type="button" id="btn-mgr-add-pers" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5 shrink-0">' +
                ui.icon('plus', 'w-3.5 h-3.5') + '<span>New Personality</span>' +
              '</button>' +
            '</div>' +

            '<div class="grid gap-2 max-h-[380px] overflow-y-auto pr-1">' +
              all.map((p) => (
                '<div class="p-3 rounded-lg bg-panel border border-line flex items-center justify-between gap-3 shadow-2xs hover:border-accent/40 transition-colors">' +
                  '<div class="min-w-0 flex-1">' +
                    '<div class="flex items-center gap-2 flex-wrap">' +
                      '<span class="font-bold text-ink text-xs">' + ui.esc(p.manufacturer) + ' ' + ui.esc(p.model) + '</span>' +
                      '<span class="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-accent/15 text-accent border border-accent/25">' + p.channels + 'ch</span>' +
                      (p.isFactory ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-panel2 text-muted border border-line">Built-in</span>' : '<span class="text-[9px] px-1.5 py-0.2 rounded bg-ok/15 text-ok border border-ok/30 font-semibold">Custom</span>') +
                    '</div>' +
                    '<div class="text-[11px] text-muted flex items-center gap-2 mt-0.5">' +
                      '<span>' + ui.esc(p.mode || 'Standard') + '</span>' +
                      '<span class="text-line">\u2022</span>' +
                      '<span>' + ui.esc(p.category || 'Fixture') + '</span>' +
                    '</div>' +
                  '</div>' +
                  '<div class="flex items-center gap-1.5 shrink-0">' +
                    '<button type="button" data-mgr-edit="' + p.id + '" class="btn btn-ghost text-xs !p-1.5 hover:text-accent" title="Edit Personality">' +
                      ui.icon('edit', 'w-3.5 h-3.5') +
                    '</button>' +
                  '</div>' +
                '</div>'
              )).join('') +
            '</div>' +

            '<div class="flex items-center justify-end pt-2 border-t border-line/60">' +
              '<button type="button" class="btn btn-primary text-xs" data-close-modal>Done</button>' +
            '</div>' +
          '</div>'
      });

      const addBtn = m.root.querySelector('#btn-mgr-add-pers');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          m.close();
          openPersonalityModal(null, () => {
            openPersonalitiesManagerModal(onSelectedOrSaved);
            if (typeof onSelectedOrSaved === 'function') onSelectedOrSaved();
          });
        });
      }

      m.root.querySelectorAll('[data-mgr-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-mgr-edit');
          const item = getPersonality(id);
          if (item) {
            m.close();
            openPersonalityModal(item, () => {
              openPersonalitiesManagerModal(onSelectedOrSaved);
              if (typeof onSelectedOrSaved === 'function') onSelectedOrSaved();
            });
          }
        });
      });
    }

    renderManager();
  }

  return {
    getAllPatches,
    getPatch,
    savePatch,
    deletePatch,
    getAllPersonalities,
    getPersonality,
    savePersonality,
    deletePersonality,
    getEndAddress,
    formatDmxAddress,
    validatePatch,
    autoAddressSequential,
    exportCsv,
    openPersonalityModal,
    openPersonalitiesManagerModal,
    STANDARD_LOCATIONS,
    FACTORY_PERSONALITIES
  };
})();
