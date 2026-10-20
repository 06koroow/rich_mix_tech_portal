/* ============================================================
   venues.js — Venues & Spaces (Setup)
   ============================================================ */
(function () {
  const ui = RMTP.ui, store = RMTP.store;
  let m = { root: null, activeSpace: null, venueData: null, invSearch: '', invSelected: new Set() };

  function getCategories() {
    const baseCats = ['Sound - Consoles', 'Sound - PA/Speakers', 'Sound - Microphones', 'Sound - DI/Stands', 'Sound - Playback', 'Sound - Control', 'Backline', 'DJ Equipment', 'Lighting - Control', 'Lighting - Fixtures', 'Lighting - Rigging/Other', 'AV - Projection/Screens', 'Network - Projection/Screens', 'Power', 'Staging/Flooring', 'Other'];
    const usedCats = store.all('inventory').map(it => it.category).filter(Boolean);
    return Array.from(new Set(baseCats.concat(usedCats))).sort((a, b) => a.localeCompare(b));
  }

  const DISCIPLINES = RMTP.DISCIPLINES || ['Sound', 'Lighting', 'Cinema', 'AV', 'Stage', 'Support', 'Duty Manager'];

  function getDisciplineTheme(role) {
    const r = String(role || '').toLowerCase();
    if (r.includes('sound') || r.includes('audio')) {
      return { bg: 'bg-emerald-500/15', color: 'text-emerald-400', border: 'border-emerald-500/30', icon: 'volume' };
    }
    if (r.includes('light')) {
      return { bg: 'bg-amber-500/15', color: 'text-amber-400', border: 'border-amber-500/30', icon: 'sun' };
    }
    if (r.includes('cinema') || r.includes('film') || r.includes('dcp')) {
      return { bg: 'bg-indigo-500/15', color: 'text-indigo-400', border: 'border-indigo-500/30', icon: 'grid' };
    }
    if (r.includes('av') || r.includes('video') || r.includes('screen')) {
      return { bg: 'bg-sky-500/15', color: 'text-sky-400', border: 'border-sky-500/30', icon: 'eye' };
    }
    if (r.includes('stage') || r.includes('floor') || r.includes('backline')) {
      return { bg: 'bg-purple-500/15', color: 'text-purple-400', border: 'border-purple-500/30', icon: 'sliders' };
    }
    if (r.includes('manager') || r.includes('lead') || r.includes('duty')) {
      return { bg: 'bg-rose-500/15', color: 'text-rose-400', border: 'border-rose-500/30', icon: 'user' };
    }
    return { bg: 'bg-panel2', color: 'text-ink', border: 'border-line', icon: 'wrench' };
  }

  function loadVenueData() {
    let v = store.find('venues', m.activeSpace);
    const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(m.activeSpace) : { total: 1, disciplines: [{ role: 'Sound', count: 1 }] };
    if (!v) {
      v = {
        id: m.activeSpace,
        name: m.activeSpace,
        capacity: '',
        stageDimensions: '',
        inventory: '',
        basicCrew: specs.total,
        crewDisciplines: specs.disciplines.map(d => ({ ...d })),
        audio: {
          inputChannels: 48,
          localInputChannels: 8,
          outputChannels: 24,
          localOutputChannels: 8,
          prefix: (m.activeSpace || 'RM').slice(0, 2).toUpperCase(),
          mixingDeskProtocol: 'Dante',
          mixingDeskInvId: '',
          stageboxes: [
            { letter: 'A', name: 'SL Rack', location: 'Stage Left', sockets: 16 }
          ]
        },
        dmx: []
      };
    }
    if (!v.crewDisciplines || !Array.isArray(v.crewDisciplines) || v.crewDisciplines.length === 0) {
      v.crewDisciplines = specs.disciplines.map(d => ({ ...d }));
    }
    v.basicCrew = v.crewDisciplines.reduce((sum, d) => sum + (parseInt(d.count, 10) || 0), 0);
    m.venueData = JSON.parse(JSON.stringify(v));
  }

  function saveVenueData() {
    store.upsert('venues', m.venueData);
    ui.toast('Saved ' + m.venueData.name + ' specs', 'ok');
  }

  function render() {
    if (!m.root) return;
    
    const spaces = RMTP.SPACES || [];
    if (!m.activeSpace && spaces.length > 0) {
      m.activeSpace = spaces[0];
      loadVenueData();
    }
    
    if (spaces.length === 0) {
      m.root.innerHTML = '<div class="flex flex-col md:flex-row min-h-[calc(100vh-140px)] md:h-[calc(100vh-100px)] border border-line rounded-xl bg-panel overflow-hidden shadow-sm">' +
        '<div class="w-full md:w-64 border-b md:border-b-0 md:border-r border-line bg-panel2/30 flex flex-col shrink-0">' +
          '<div class="hidden md:block p-3 border-b border-line"><h2 class="font-display font-semibold text-sm">Venues & Spaces</h2></div>' +
          '<div class="flex-1 flex items-center justify-center p-3 md:p-4 text-sm text-muted italic">No spaces configured.</div>' +
          '<div class="p-3 border-t border-line"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button></div>' +
        '</div>' +
        '<div class="flex-1 flex items-center justify-center text-muted italic">Please add a space to continue.</div>' +
      '</div>';
      attachEvents();
      return;
    }

    // Backward compatibility for newly added fields
    if (!m.venueData.audio.mixingDeskProtocol) m.venueData.audio.mixingDeskProtocol = 'Dante';
    if (m.venueData.audio.mixingDeskInvId === undefined) m.venueData.audio.mixingDeskInvId = '';

    const allInv = store.all('inventory').sort((a,b) => (a.name||'').localeCompare(b.name||''));
    const inventoryOptions = (selectedId, catFilter) => {
      let items = allInv;
      if (catFilter) items = items.filter(it => (it.category || '').toLowerCase().includes(catFilter.toLowerCase()));
      return items.map(it => '<option value="' + ui.esc(it.id) + '" ' + (it.id === selectedId ? 'selected' : '') + '>' + ui.esc(it.name + (it.tag ? ' ['+it.tag+']' : '')) + '</option>').join('');
    };
    const protos = ['Analog', 'Dante', 'AES50', 'MADI', 'AVB', 'Optocore', 'AES3', 'Milan'];
    const protocolOptions = (selectedProto) => protos.map(p => '<option value="' + p + '" ' + (p === selectedProto ? 'selected' : '') + '>' + p + '</option>').join('');

    m.root.innerHTML =
      '<div class="flex flex-col md:flex-row min-h-[calc(100vh-140px)] md:h-[calc(100vh-100px)] border border-line rounded-xl bg-panel overflow-hidden shadow-sm">' +
        // Left Sidebar: List of Venues
        '<div class="w-full md:w-64 border-b md:border-b-0 md:border-r border-line bg-panel2/30 flex flex-col shrink-0 min-h-0">' +
          '<div class="hidden md:block p-3 border-b border-line">' +
            '<h2 class="font-display font-semibold text-sm">Venues & Spaces</h2>' +
          '</div>' +
          '<div class="flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto p-2 gap-2 md:gap-0 md:space-y-1.5 scrollbar-hide">' +
            spaces.map(sp => {
              const isActive = sp === m.activeSpace;
              const specs = RMTP.getSpaceCrewSpecs ? RMTP.getSpaceCrewSpecs(sp) : { total: 1, disciplines: [] };
              return '<button data-space="' + ui.esc(sp) + '" class="whitespace-nowrap md:w-full text-left px-3 py-2 text-xs md:text-sm font-medium rounded-lg shrink-0 flex flex-col gap-0.5 ' + (isActive ? 'bg-panel border border-line shadow-xs text-ink ring-1 ring-accent/30' : 'text-muted hover:bg-panel/50 hover:text-ink transition-colors') + '">' +
                '<div class="flex items-center justify-between w-full gap-2">' +
                  '<span class="font-semibold truncate">' + ui.esc(sp) + '</span>' +
                  '<span class="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-panel2 border border-line text-accent shrink-0">' + specs.total + ' tech' + (specs.total === 1 ? '' : 's') + '</span>' +
                '</div>' +
                '<span class="text-[10.5px] text-muted truncate max-w-[210px]">' + ui.esc(specs.summary || 'No crew set') + '</span>' +
              '</button>';
            }).join('') +
            '<button id="btn-add-space-mobile" class="md:hidden whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-lg shrink-0 btn-ghost border border-dashed border-line flex items-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button>' +
          '</div>' +
          '<div class="hidden md:block p-3 border-t border-line mt-auto"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button></div>' +
        '</div>' +

        // Right Main Canvas: Configuration
        '<div class="flex-1 flex flex-col bg-panel relative overflow-hidden">' +
          '<div class="px-4 md:px-6 py-3 md:py-4 border-b border-line flex items-center justify-between gap-2 md:gap-3 bg-panel/50 backdrop-blur sticky top-0 z-10">' +
            '<h1 class="text-base sm:text-lg md:text-xl font-display font-bold truncate pr-2">' + ui.esc(m.activeSpace || 'Select a Venue') + '</h1>' +
            '<div class="flex items-center gap-1.5 md:gap-2 shrink-0">' +
              '<button id="btn-save-venue" class="btn btn-primary btn-sm flex items-center justify-center gap-1.5 shadow-sm !p-1.5 md:!px-3 md:!py-1.5 aspect-square md:aspect-auto" title="Save Changes">' +
                ui.icon('check', 'w-4 h-4') + '<span class="hidden md:inline">Save</span>' +
              '</button>' +
              '<button id="btn-print-venue" class="btn btn-ghost border border-line btn-sm flex items-center justify-center gap-1.5 shadow-sm !p-1.5 md:!px-3 md:!py-1.5 aspect-square md:aspect-auto" title="Print Tech Spec">' +
                ui.icon('print', 'w-4 h-4') + '<span class="hidden md:inline">Print</span>' +
              '</button>' +
              (RMTP.auth.current() && RMTP.auth.current().admin && m.activeSpace ? 
              '<button id="btn-delete-space" class="btn btn-danger btn-sm flex items-center justify-center gap-1.5 shadow-sm !p-1.5 md:!px-3 md:!py-1.5 aspect-square md:aspect-auto" title="Delete Space">' + ui.icon('trash', 'w-4 h-4') + '<span class="hidden md:inline">Delete</span></button>' : '') +
            '</div>' +
          '</div>' +
          '<div class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8" id="venue-config-forms">' +
            
            // Tab Overview Concept
            '<div class="grid gap-4">' +
              '<h3 class="text-xs font-bold uppercase tracking-wider text-muted border-b border-line pb-2">Overview & Specs</h3>' +
              '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
                '<div><label class="text-[10px] font-bold text-muted uppercase">Capacity</label><input type="text" class="field" id="v-capacity" value="' + ui.esc(m.venueData.capacity) + '" placeholder="e.g. 500 Standing"></div>' +
                '<div><label class="text-[10px] font-bold text-muted uppercase">Stage Dimensions</label><input type="text" class="field" id="v-dims" value="' + ui.esc(m.venueData.stageDimensions) + '" placeholder="e.g. 8m x 6m"></div>' +
              '</div>' +

              // Minimum Crew & Disciplines Panel
              '<div class="grid gap-3 p-4 rounded-xl border border-accent/30 bg-accent/5 shadow-2xs">' +
                '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-2.5">' +
                  '<div>' +
                    '<div class="flex items-center gap-2">' +
                      '<h4 class="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">' +
                        ui.icon('users', 'w-4 h-4 text-accent') +
                        '<span>Minimum Crew & Disciplines</span>' +
                      '</h4>' +
                      '<span id="v-crew-total-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-accent/20 text-accent border border-accent/40 shadow-2xs">' +
                        m.venueData.basicCrew + ' Total Required' +
                      '</span>' +
                    '</div>' +
                    '<p class="text-[11px] text-muted mt-0.5">' +
                      'Specify the required technical headcount and specific disciplines (Sound, Lighting, Cinema, AV, etc.) for ' + ui.esc(m.activeSpace) + '. This synchronises directly with the Rota, Shift Bookings, Takeovers, and Event Advancing.' +
                    '</p>' +
                  '</div>' +
                  '<button type="button" id="btn-add-crew-discipline" class="btn btn-ghost text-xs border border-line flex items-center gap-1.5 self-start sm:self-auto shrink-0 shadow-2xs hover:border-accent hover:bg-panel2 transition">' +
                    ui.icon('plus', 'w-3.5 h-3.5 text-accent') +
                    '<span>Add Discipline</span>' +
                  '</button>' +
                '</div>' +

                // Quick Add Discipline Chips
                '<div class="flex items-center gap-1.5 flex-wrap pt-0.5">' +
                  '<span class="text-[10px] text-muted font-bold uppercase tracking-wider mr-0.5">Quick Add:</span>' +
                  DISCIPLINES.map(d => {
                    const theme = getDisciplineTheme(d);
                    return '<button type="button" data-quick-add-disc="' + d + '" class="px-2 py-0.5 rounded-md text-[10.5px] font-semibold border transition shadow-2xs flex items-center gap-1 hover:opacity-85 ' + theme.bg + ' ' + theme.color + ' ' + theme.border + '">' +
                      ui.icon('plus', 'w-2.5 h-2.5') +
                      '<span>' + d + '</span>' +
                    '</button>';
                  }).join('') +
                '</div>' +

                '<div class="space-y-2" id="v-disciplines-container">' +
                  (m.venueData.crewDisciplines.length === 0 ? 
                    '<div class="p-4 text-center text-xs text-muted italic border border-dashed border-line/60 rounded-lg">No crew disciplines configured yet. Use "Quick Add" above or click "Add Discipline".</div>' : 
                    m.venueData.crewDisciplines.map((cd, idx) => {
                      const theme = getDisciplineTheme(cd.role);
                      return '<div class="flex items-center gap-2.5 p-2 rounded-lg bg-panel border border-line shadow-2xs">' +
                        '<div class="w-8 h-8 rounded-lg ' + theme.bg + ' flex items-center justify-center shrink-0 border ' + theme.border + '">' +
                          ui.icon(theme.icon, 'w-4 h-4 ' + theme.color) +
                        '</div>' +
                        '<div class="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">' +
                          '<div>' +
                            '<label class="text-[9px] font-bold uppercase text-muted block mb-0.5">Discipline / Technical Role</label>' +
                            '<select class="field !py-1 text-xs font-semibold" data-cd-role="' + idx + '">' +
                              DISCIPLINES.map(d => '<option value="' + d + '" ' + (d === cd.role ? 'selected' : '') + '>' + d + '</option>').join('') +
                              '<option value="__custom__" ' + (!DISCIPLINES.includes(cd.role) ? 'selected' : '') + '>Custom Role…</option>' +
                            '</select>' +
                            (!DISCIPLINES.includes(cd.role) ? 
                              '<input type="text" class="field !py-1 text-xs mt-1" data-cd-custom="' + idx + '" value="' + ui.esc(cd.role) + '" placeholder="Role name">' : '') +
                          '</div>' +
                          '<div>' +
                            '<label class="text-[9px] font-bold uppercase text-muted block mb-0.5">Required Headcount</label>' +
                            '<div class="flex items-center gap-1">' +
                              '<button type="button" data-cd-step="-1" data-cd-step-idx="' + idx + '" class="w-7 h-7 rounded bg-panel2 border border-line flex items-center justify-center font-bold text-xs hover:bg-panel hover:text-accent select-none transition shadow-2xs" title="Decrease headcount">-</button>' +
                              '<input type="number" min="1" max="15" class="field !py-1 text-xs font-mono font-bold w-14 text-center" data-cd-count="' + idx + '" value="' + (cd.count || 1) + '">' +
                              '<button type="button" data-cd-step="1" data-cd-step-idx="' + idx + '" class="w-7 h-7 rounded bg-panel2 border border-line flex items-center justify-center font-bold text-xs hover:bg-panel hover:text-accent select-none transition shadow-2xs" title="Increase headcount">+</button>' +
                              '<span class="text-xs text-muted ml-1">technician' + ((cd.count || 1) > 1 ? 's' : '') + '</span>' +
                            '</div>' +
                          '</div>' +
                        '</div>' +
                        '<button type="button" class="btn btn-ghost text-danger !p-1.5 hover:bg-danger/10 rounded-lg shrink-0" data-cd-del="' + idx + '" title="Remove discipline">' +
                          ui.icon('trash', 'w-4 h-4') +
                        '</button>' +
                      '</div>';
                    }).join('')
                  ) +
                '</div>' +

                '<div class="pt-2 border-t border-line/60 flex flex-wrap items-center gap-1.5 text-xs">' +
                  '<span class="text-[10px] font-bold uppercase text-muted tracking-wider mr-1">Active Staffing Spec:</span>' +
                  m.venueData.crewDisciplines.map(cd => {
                    const theme = getDisciplineTheme(cd.role);
                    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-[11px] border ' + theme.bg + ' ' + theme.color + ' ' + theme.border + '">' +
                      '<span>' + (cd.count || 1) + 'x ' + ui.esc(cd.role) + '</span>' +
                    '</span>';
                  }).join('') +
                  '<span id="v-crew-total-text" class="ml-auto font-mono text-[11px] font-bold text-ink">' +
                    '= ' + m.venueData.basicCrew + ' Technicians Minimum' +
                  '</span>' +
                '</div>' +
              '</div>' +

              '<div><label class="text-[10px] font-bold text-muted uppercase">Standard Inventory / Backline</label><textarea class="field min-h-[80px]" id="v-inv" placeholder="Drum kit, DJ setup, default wedges...">' + ui.esc(m.venueData.inventory) + '</textarea></div>' +
            '</div>' +

            '<div class="grid gap-4">' +
              '<h3 class="text-xs font-bold uppercase tracking-wider text-muted border-b border-line pb-2">Permanent Audio I/O Architecture</h3>' +
              '<div class="grid gap-4 p-4 rounded-xl border border-line bg-panel2/50">' +
                '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase">Audio End Point (Mixing Console)</label>' +
                  '<select class="field" id="v-audio-desk-id"><option value="">-- None / Select from Inventory --</option>' + inventoryOptions(m.venueData.audio.mixingDeskInvId, 'Sound - Consoles') + '</select></div>' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase">Desk Network / Protocol</label>' +
                  '<select class="field" id="v-audio-desk-proto">' + protocolOptions(m.venueData.audio.mixingDeskProtocol) + '</select></div>' +
                '</div>' +
                '<div class="grid grid-cols-1 md:grid-cols-2 md:grid-cols-5 gap-3 border-t border-line pt-4">' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase" title="Total Network/Stage Inputs">Total Inputs</label><input type="number" class="field !px-2 !py-1.5" id="v-audio-in" value="' + m.venueData.audio.inputChannels + '"></div>' +
                  '<div><label class="text-[10px] font-bold text-accent uppercase" title="Local FOH Desk Inputs">Local Ins (FOH)</label><input type="number" class="field !px-2 !py-1.5 border-accent/30 bg-accent/5" id="v-audio-local-in" value="' + (m.venueData.audio.localInputChannels || 0) + '"></div>' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase" title="Total Network/Stage Outputs">Total Outputs</label><input type="number" class="field !px-2 !py-1.5" id="v-audio-out" value="' + m.venueData.audio.outputChannels + '"></div>' +
                  '<div><label class="text-[10px] font-bold text-accent uppercase" title="Local FOH Desk Outputs">Local Outs (FOH)</label><input type="number" class="field !px-2 !py-1.5 border-accent/30 bg-accent/5" id="v-audio-local-out" value="' + (m.venueData.audio.localOutputChannels || 0) + '"></div>' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase">Prefix</label><input type="text" class="field !px-2 !py-1.5" id="v-audio-pref" value="' + ui.esc(m.venueData.audio.prefix) + '"></div>' +
                '</div>' +
              '</div>' +
              '<div class="text-sm font-semibold">Stageboxes</div>' +
              '<div class="grid gap-2" id="v-stageboxes-container">' +
                m.venueData.audio.stageboxes.map((sb, idx) => 
                  '<div class="p-3 border border-line rounded-lg bg-panel space-y-3">' +
                     '<div class="flex items-center gap-2">' +
                        '<input type="text" class="field w-16" value="' + ui.esc(sb.letter) + '" data-sb-field="letter" data-sb-idx="' + idx + '" placeholder="Ltr">' +
                        '<input type="text" class="field flex-1" value="' + ui.esc(sb.name) + '" data-sb-field="name" data-sb-idx="' + idx + '" placeholder="Box Name">' +
                        '<input type="text" class="field flex-1" value="' + ui.esc(sb.location) + '" data-sb-field="location" data-sb-idx="' + idx + '" placeholder="Location">' +
                        '<button type="button" class="btn btn-ghost text-danger p-1" data-sb-del="' + idx + '">' + ui.icon('x', 'w-4 h-4') + '</button>' +
                     '</div>' +
                     '<div class="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-2">' +
                        '<div><label class="text-[10px] uppercase text-muted">Inventory Link</label><select class="field !py-1" data-sb-field="invId" data-sb-idx="' + idx + '"><option value="">- Select -</option>' + inventoryOptions(sb.invId, 'Stageboxes') + '</select></div>' +
                        '<div><label class="text-[10px] uppercase text-muted">Protocol</label><select class="field !py-1" data-sb-field="connectionProtocol" data-sb-idx="' + idx + '">' + protocolOptions(sb.connectionProtocol || 'Dante') + '</select></div>' +
                        '<div><label class="text-[10px] uppercase text-muted">Analog I/O</label><div class="flex items-center gap-1">' +
                          '<input type="number" class="field !py-1 w-full" value="' + (sb.analogIn !== undefined ? sb.analogIn : (sb.sockets || 16)) + '" data-sb-field="analogIn" data-sb-idx="' + idx + '" title="Inputs"><span class="text-muted text-xs">/</span>' +
                          '<input type="number" class="field !py-1 w-full" value="' + (sb.analogOut || 0) + '" data-sb-field="analogOut" data-sb-idx="' + idx + '" title="Outputs"></div></div>' +
                        '<div><label class="text-[10px] uppercase text-muted">Digital I/O</label><div class="flex items-center gap-1">' +
                          '<input type="number" class="field !py-1 w-full" value="' + (sb.digitalIn || 0) + '" data-sb-field="digitalIn" data-sb-idx="' + idx + '" title="Inputs"><span class="text-muted text-xs">/</span>' +
                          '<input type="number" class="field !py-1 w-full" value="' + (sb.digitalOut || 0) + '" data-sb-field="digitalOut" data-sb-idx="' + idx + '" title="Outputs"></div></div>' +
                     '</div>' +
                  '</div>'
                ).join('') +
                '<button type="button" id="btn-add-sb" class="btn btn-ghost text-xs border border-dashed border-line w-fit">Add Stagebox</button>' +
              '</div>' +
            '</div>' +

            '<div class="grid gap-4">' +
              '<h3 class="text-xs font-bold uppercase tracking-wider text-muted border-b border-line pb-2">Lighting Rig (Permanent DMX Patch)</h3>' +
              '<div class="text-sm font-semibold flex items-center justify-between">' +
                '<span>Fixtures</span>' +
                '<button type="button" id="btn-add-fixture" class="btn btn-ghost text-xs border border-line shadow-xs">' + ui.icon('plus', 'w-3 h-3 mr-1') + 'Add Fixture</button>' +
              '</div>' +
              '<div class="overflow-x-auto rounded-lg border border-line">' +
                '<table class="w-full text-left text-xs">' +
                  '<thead class="bg-panel2/60 border-b border-line uppercase text-[10px] text-muted">' +
                    '<tr><th class="p-2">ID</th><th class="p-2">Make/Model</th><th class="p-2">Mode/Chs</th><th class="p-2">Univ</th><th class="p-2">Addr</th><th class="p-2">Location</th><th class="p-2"></th></tr>' +
                  '</thead>' +
                  '<tbody class="divide-y divide-line/40">' +
                    (m.venueData.dmx.length === 0 ? '<tr><td colspan="7" class="p-4 text-center text-muted italic">No permanent fixtures mapped.</td></tr>' : 
                      m.venueData.dmx.map((fix, idx) => 
                        '<tr class="hover:bg-panel2/30">' +
                          '<td class="p-1"><input type="number" class="field !py-1 !px-1.5" value="' + fix.idNum + '" data-fx-field="idNum" data-fx-idx="' + idx + '"></td>' +
                          '<td class="p-1"><input type="text" class="field !py-1 !px-1.5 w-full" value="' + ui.esc(fix.makeModel) + '" data-fx-field="makeModel" data-fx-idx="' + idx + '"></td>' +
                          '<td class="p-1 flex items-center gap-1"><input type="text" class="field !py-1 !px-1.5 w-16" value="' + ui.esc(fix.mode) + '" placeholder="Mode" data-fx-field="mode" data-fx-idx="' + idx + '"><input type="number" class="field !py-1 !px-1.5 w-12" value="' + fix.channels + '" placeholder="Chs" data-fx-field="channels" data-fx-idx="' + idx + '"></td>' +
                          '<td class="p-1"><input type="number" class="field !py-1 !px-1.5 w-12" value="' + fix.universe + '" data-fx-field="universe" data-fx-idx="' + idx + '"></td>' +
                          '<td class="p-1"><input type="number" class="field !py-1 !px-1.5 w-16" value="' + fix.address + '" data-fx-field="address" data-fx-idx="' + idx + '"></td>' +
                          '<td class="p-1"><input type="text" class="field !py-1 !px-1.5 w-full" value="' + ui.esc(fix.location) + '" data-fx-field="location" data-fx-idx="' + idx + '"></td>' +
                          '<td class="p-1 text-right"><button type="button" class="btn btn-ghost text-danger !p-1" data-fx-del="' + idx + '">' + ui.icon('x', 'w-3 h-3') + '</button></td>' +
                        '</tr>'
                      ).join('')
                    ) +
                  '</tbody>' +
                '</table>' +
              '</div>' +
            '</div>' +

            '<div class="grid gap-4">' +
              '<h3 class="text-xs font-bold uppercase tracking-wider text-muted border-b border-line pb-2">Venue Inventory (Live)</h3>' +
              '<div class="flex flex-col md:flex-row md:items-center justify-between gap-3">' +
                '<input type="text" id="v-inv-search" class="field w-full md:w-64" placeholder="Search inventory..." value="' + ui.esc(m.invSearch) + '">' +
                '<div class="flex flex-wrap gap-2">' +
                  '<label class="btn btn-ghost text-xs border border-line shadow-xs cursor-pointer">' +
                    ui.icon('upload', 'w-3 h-3 mr-1') + ' Import CSV' +
                    '<input type="file" id="v-inv-csv" accept=".csv" class="hidden">' +
                  '</label>' +
                  '<button type="button" id="btn-add-inv" class="btn btn-ghost text-xs border border-line shadow-xs">' + ui.icon('plus', 'w-3 h-3 mr-1') + 'Add Item</button>' +
                  '<button type="button" id="btn-del-inv" class="btn btn-ghost text-danger text-xs border border-line shadow-xs ' + (m.invSelected.size > 0 ? '' : 'hidden') + '">' + ui.icon('trash', 'w-3 h-3 mr-1') + 'Delete Selected</button>' +
                '</div>' +
              '</div>' +
              '<div class="overflow-x-auto overflow-y-auto rounded-lg border border-line max-h-64">' +
                '<table class="w-full text-left text-xs relative">' +
                  '<thead class="bg-panel2/90 backdrop-blur border-b border-line uppercase text-[10px] text-muted sticky top-0 z-10">' +
                    '<tr><th class="p-2 w-8 text-center"><input type="checkbox" id="v-inv-sel-all"></th><th class="p-2">Name</th><th class="p-2">Category</th><th class="p-2">Condition</th><th class="p-2">Tag/Barcode</th><th class="p-2">Qty</th></tr>' +
                  '</thead>' +
                  '<tbody id="v-inv-tbody" class="divide-y divide-line/40"></tbody>' +
                '</table>' +
              '</div>' +
            '</div>' +

          '</div>' +
        '</div>' +
      '</div>';

    attachEvents();
    renderInventory();
  }

  function attachEvents() {
    m.root.querySelectorAll('[data-space]').forEach(btn => {
      btn.addEventListener('click', () => {
        m.activeSpace = btn.getAttribute('data-space');
        m.invSelected.clear();
        m.invSearch = '';
        loadVenueData();
        render();
      });
    });

    const bindInput = (id, obj, field, isNum) => {
      const el = m.root.querySelector(id);
      if (el) el.addEventListener('input', () => {
        obj[field] = isNum ? parseInt(el.value, 10) || 0 : el.value;
      });
    };

    if (m.venueData) {
      bindInput('#v-capacity', m.venueData, 'capacity');
      bindInput('#v-dims', m.venueData, 'stageDimensions');
      bindInput('#v-inv', m.venueData, 'inventory');

      // Minimum Crew & Disciplines Handlers with Instant Auto-Persistence
      function syncDisciplines(reRender) {
        m.venueData.basicCrew = (m.venueData.crewDisciplines || []).reduce((sum, d) => sum + (parseInt(d.count, 10) || 0), 0);
        store.upsert('venues', m.venueData);
        window.dispatchEvent(new CustomEvent('rmtp:venues-updated', { detail: { space: m.venueData.name, specs: m.venueData } }));
        if (reRender) {
          render();
        } else {
          const totalBadge = m.root.querySelector('#v-crew-total-badge');
          if (totalBadge) totalBadge.textContent = m.venueData.basicCrew + ' Total Required';
          const totalText = m.root.querySelector('#v-crew-total-text');
          if (totalText) totalText.textContent = '= ' + m.venueData.basicCrew + ' Technicians Minimum';
        }
      }

      // Quick Add Discipline Chips
      m.root.querySelectorAll('[data-quick-add-disc]').forEach(btn => {
        btn.addEventListener('click', () => {
          const role = btn.getAttribute('data-quick-add-disc');
          if (!m.venueData.crewDisciplines) m.venueData.crewDisciplines = [];
          const existing = m.venueData.crewDisciplines.find(d => d.role.toLowerCase() === role.toLowerCase());
          if (existing) {
            existing.count = (parseInt(existing.count, 10) || 1) + 1;
            ui.toast(`Increased ${role} requirement to ${existing.count}`, 'ok');
          } else {
            m.venueData.crewDisciplines.push({ role: role, count: 1 });
            ui.toast(`Added ${role} discipline to ${m.venueData.name}`, 'ok');
          }
          syncDisciplines(true);
        });
      });

      // Role Select
      m.root.querySelectorAll('[data-cd-role]').forEach(sel => {
        sel.addEventListener('change', () => {
          const idx = parseInt(sel.getAttribute('data-cd-role'), 10);
          const val = sel.value;
          if (val === '__custom__') {
            m.venueData.crewDisciplines[idx].role = 'Custom';
          } else {
            m.venueData.crewDisciplines[idx].role = val;
          }
          syncDisciplines(true);
        });
      });

      // Custom Role Input
      m.root.querySelectorAll('[data-cd-custom]').forEach(inp => {
        inp.addEventListener('input', () => {
          const idx = parseInt(inp.getAttribute('data-cd-custom'), 10);
          m.venueData.crewDisciplines[idx].role = inp.value.trim() || 'Custom';
          syncDisciplines(false);
        });
      });

      // Headcount Input
      m.root.querySelectorAll('[data-cd-count]').forEach(inp => {
        inp.addEventListener('input', () => {
          const idx = parseInt(inp.getAttribute('data-cd-count'), 10);
          const val = Math.max(1, parseInt(inp.value, 10) || 1);
          m.venueData.crewDisciplines[idx].count = val;
          syncDisciplines(false);
        });
      });

      // Headcount Stepper Buttons (+ / -)
      m.root.querySelectorAll('[data-cd-step]').forEach(btn => {
        btn.addEventListener('click', () => {
          const delta = parseInt(btn.getAttribute('data-cd-step'), 10);
          const idx = parseInt(btn.getAttribute('data-cd-step-idx'), 10);
          const cur = parseInt(m.venueData.crewDisciplines[idx].count, 10) || 1;
          const nextVal = Math.max(1, cur + delta);
          m.venueData.crewDisciplines[idx].count = nextVal;
          syncDisciplines(true);
        });
      });

      // Delete Discipline Row
      m.root.querySelectorAll('[data-cd-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-cd-del'), 10);
          const removed = m.venueData.crewDisciplines.splice(idx, 1);
          if (removed && removed[0]) ui.toast(`Removed ${removed[0].role} discipline`, 'info');
          syncDisciplines(true);
        });
      });

      // Add Discipline Button
      const btnAddDiscipline = m.root.querySelector('#btn-add-crew-discipline');
      if (btnAddDiscipline) {
        btnAddDiscipline.addEventListener('click', () => {
          const existingRoles = (m.venueData.crewDisciplines || []).map(d => d.role);
          const nextRole = DISCIPLINES.find(d => !existingRoles.includes(d)) || 'Sound';
          if (!m.venueData.crewDisciplines) m.venueData.crewDisciplines = [];
          m.venueData.crewDisciplines.push({ role: nextRole, count: 1 });
          syncDisciplines(true);
        });
      }
    bindInput('#v-audio-in', m.venueData.audio, 'inputChannels', true);
    bindInput('#v-audio-local-in', m.venueData.audio, 'localInputChannels', true);
    bindInput('#v-audio-out', m.venueData.audio, 'outputChannels', true);
    bindInput('#v-audio-local-out', m.venueData.audio, 'localOutputChannels', true);
    bindInput('#v-audio-pref', m.venueData.audio, 'prefix');
    bindInput('#v-audio-desk-id', m.venueData.audio, 'mixingDeskInvId');
    bindInput('#v-audio-desk-proto', m.venueData.audio, 'mixingDeskProtocol');

    m.root.querySelectorAll('[data-sb-field]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = inp.getAttribute('data-sb-idx');
        const field = inp.getAttribute('data-sb-field');
        const isNum = field === 'analogIn' || field === 'analogOut' || field === 'digitalIn' || field === 'digitalOut' || field === 'sockets';
        m.venueData.audio.stageboxes[idx][field] = isNum ? parseInt(inp.value, 10) || 0 : inp.value;
      });
    });

    m.root.querySelectorAll('[data-fx-field]').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = inp.getAttribute('data-fx-idx');
        const field = inp.getAttribute('data-fx-field');
        m.venueData.dmx[idx][field] = (field === 'idNum' || field === 'universe' || field === 'address' || field === 'channels') ? parseInt(inp.value, 10) || 0 : inp.value;
      });
    });

    const btnAddSb = m.root.querySelector('#btn-add-sb');
    if (btnAddSb) {
      btnAddSb.addEventListener('click', () => {
        m.venueData.audio.stageboxes.push({ 
          letter: '', name: 'New Box', location: '', invId: '', 
          connectionProtocol: 'Dante', analogIn: 16, analogOut: 8, digitalIn: 0, digitalOut: 0 
        });
        render();
      });
    }

    m.root.querySelectorAll('[data-sb-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.getAttribute('data-sb-del');
        m.venueData.audio.stageboxes.splice(idx, 1);
        render();
      });
    });

    const btnAddFx = m.root.querySelector('#btn-add-fixture');
    if (btnAddFx) {
      btnAddFx.addEventListener('click', () => {
        m.venueData.dmx.push({ idNum: m.venueData.dmx.length + 1, makeModel: '', mode: '', channels: 1, universe: 1, address: 1, location: '' });
        render();
      });
    }

    m.root.querySelectorAll('[data-fx-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.getAttribute('data-fx-del');
        m.venueData.dmx.splice(idx, 1);
        render();
      });
    });
    }


    const btnAddSpaceEls = m.root.querySelectorAll('#btn-add-space, #btn-add-space-mobile');
    btnAddSpaceEls.forEach(btn => {
      btn.addEventListener('click', () => {
        const name = prompt('Enter name for the new space:');
        if (name && name.trim()) {
          const newName = name.trim();
          const deleted = store.read('deleted_spaces', []) || [];
          if (deleted.includes(newName)) {
            store.write('deleted_spaces', deleted.filter(s => s !== newName));
          }
          if (RMTP.SPACES.indexOf(newName) === -1) {
            RMTP.SPACES.push(newName);
            const spaceOrder = {
              'The Stage': 1, 'The Studio': 2, 'The Mix': 3, 
              'Screen One': 4, 'Screen Two': 5, 'Screen Three': 6,
              'Streetside': 7
            };
            RMTP.SPACES.sort((a, b) => {
              const wa = spaceOrder[a] || 99;
              const wb = spaceOrder[b] || 99;
              return wa !== wb ? wa - wb : a.localeCompare(b);
            });
            RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES || []);
            m.activeSpace = newName;
            loadVenueData(); // creates the default store entry
            store.upsert('venues', m.venueData);
            ui.toast('Space added: ' + newName, 'ok');
            render();
          } else {
            ui.toast('Space already exists', 'danger');
          }
        }
      });
    });

    const btnDeleteSpace = m.root.querySelector('#btn-delete-space');
    if (btnDeleteSpace) {
      btnDeleteSpace.addEventListener('click', () => {
        if (!m.activeSpace) return;
        const confirmName = prompt('WARNING: You are about to delete the space "' + m.activeSpace + '".\nThis cannot be undone. Type the name of the space exactly to confirm:');
        if (confirmName === m.activeSpace) {
          const deleted = store.read('deleted_spaces', []) || [];
          if (!deleted.includes(m.activeSpace)) {
            deleted.push(m.activeSpace);
            store.write('deleted_spaces', deleted);
          }
          store.remove('venues', m.activeSpace);
          const idx = RMTP.SPACES.indexOf(m.activeSpace);
          if (idx > -1) {
            RMTP.SPACES.splice(idx, 1);
            RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES || []);
          }
          ui.toast('Space deleted: ' + m.activeSpace, 'ok');
          m.activeSpace = null;
          render();
        } else if (confirmName !== null) {
          ui.toast('Deletion cancelled: Space name did not match', 'danger');
        }
      });
    }

    const saveBtn = m.root.querySelector('#btn-save-venue');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveVenueData);
    }

    const printBtn = m.root.querySelector('#btn-print-venue');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        ui.toast('Preparing ' + (m.activeSpace || 'Venue') + ' specs for printing...', 'info');
        setTimeout(() => window.print(), 350);
      });
    }

    const invSearch = m.root.querySelector('#v-inv-search');
    if (invSearch) {
      invSearch.addEventListener('input', () => {
        m.invSearch = invSearch.value;
        renderInventory();
      });
    }

    const btnAddInv = m.root.querySelector('#btn-add-inv');
    if (btnAddInv) {
      btnAddInv.addEventListener('click', () => {
        const item = { id: store.uid('inv'), name: 'New Item', category: 'General', condition: 'Good', tag: '', qty: 1, location: m.activeSpace, status: 'in' };
        store.upsert('inventory', item);
        renderInventory();
      });
    }

    const btnDelInv = m.root.querySelector('#btn-del-inv');
    if (btnDelInv) {
      btnDelInv.addEventListener('click', () => {
        if (confirm('Delete ' + m.invSelected.size + ' item(s)?')) {
          m.invSelected.forEach(id => store.remove('inventory', id));
          m.invSelected.clear();
          renderInventory();
          updateInvSelectionUI();
        }
      });
    }

    const selAll = m.root.querySelector('#v-inv-sel-all');
    if (selAll) {
      selAll.addEventListener('change', () => {
        const tbody = m.root.querySelector('#v-inv-tbody');
        const chks = tbody.querySelectorAll('.v-inv-chk');
        m.invSelected.clear();
        if (selAll.checked) {
          chks.forEach(chk => {
            chk.checked = true;
            m.invSelected.add(chk.getAttribute('data-id'));
          });
        } else {
          chks.forEach(chk => chk.checked = false);
        }
        renderInventory();
        updateInvSelectionUI();
      });
    }

    const csvInput = m.root.querySelector('#v-inv-csv');
    if (csvInput) {
      csvInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = ev.target.result;
          const lines = text.split('\n').map(l => l.trim()).filter(l => l);
          if (lines.length < 2) return ui.toast('CSV must have a header row and at least one item', 'danger');
          
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          let count = 0;
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',').map(p => p.trim());
            const item = { id: store.uid('inv'), location: m.activeSpace, status: 'in', qty: 1 };
            headers.forEach((h, idx) => {
              if (h === 'name') item.name = parts[idx] || 'Unknown';
              if (h === 'category') item.category = parts[idx] || 'General';
              if (h === 'condition') item.condition = parts[idx] || 'Good';
              if (h === 'tag' || h === 'barcode') item.tag = parts[idx] || '';
              if (h === 'qty' || h === 'quantity') item.qty = parseInt(parts[idx], 10) || 1;
            });
            if (item.name) {
              store.upsert('inventory', item);
              count++;
            }
          }
          ui.toast('Imported ' + count + ' items from CSV', 'ok');
          csvInput.value = '';
          renderInventory();
        };
        reader.readAsText(file);
      });
    }
  }

  function updateInvSelectionUI() {
    const delBtn = m.root.querySelector('#btn-del-inv');
    if (delBtn) {
      if (m.invSelected.size > 0) delBtn.classList.remove('hidden');
      else delBtn.classList.add('hidden');
    }
  }

  function renderInventory() {
    const tbody = m.root.querySelector('#v-inv-tbody');
    if (!tbody) return;

    let items = store.all('inventory').filter(it => it.location === m.activeSpace);
    
    if (m.invSearch) {
      const q = m.invSearch.toLowerCase();
      items = items.filter(it => 
        (it.name || '').toLowerCase().includes(q) || 
        (it.category || '').toLowerCase().includes(q) ||
        (it.tag || '').toLowerCase().includes(q)
      );
    }

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-muted italic">No inventory found for this venue.</td></tr>';
      return;
    }

    tbody.innerHTML = items.map(it => {
      const sel = m.invSelected.has(it.id);
      return '<tr class="hover:bg-panel2/30 ' + (sel ? 'bg-primary/5' : '') + '">' +
        '<td class="p-2 text-center"><input type="checkbox" class="v-inv-chk" data-id="' + it.id + '" ' + (sel ? 'checked' : '') + '></td>' +
        '<td class="p-2"><input type="text" class="field !py-1 !px-1.5 w-full bg-transparent border-transparent hover:border-line focus:bg-panel" value="' + ui.esc(it.name) + '" data-inv-field="name" data-inv-id="' + it.id + '"></td>' +
        '<td class="p-2"><select class="field !py-1 !px-1.5 w-32 bg-transparent border-transparent hover:border-line focus:bg-panel" data-inv-field="category" data-inv-id="' + it.id + '">' +
          getCategories().map(c => '<option value="' + ui.esc(c) + '" ' + (it.category === c ? 'selected' : '') + '>' + ui.esc(c) + '</option>').join('') +
          '<option value="--add--">+ Add Category...</option>' +
        '</select></td>' +
        '<td class="p-2"><select class="field !py-1 !px-1.5 w-24 bg-transparent border-transparent hover:border-line focus:bg-panel" data-inv-field="condition" data-inv-id="' + it.id + '">' +
          ['Excellent', 'Good', 'Fair', 'Poor', 'Damaged', 'Out of service'].map(c => 
            '<option value="' + c + '" ' + (it.condition === c ? 'selected' : '') + '>' + c + '</option>'
          ).join('') +
        '</select></td>' +
        '<td class="p-2"><input type="text" class="field !py-1 !px-1.5 w-24 bg-transparent border-transparent hover:border-line focus:bg-panel" value="' + ui.esc(it.tag) + '" data-inv-field="tag" data-inv-id="' + it.id + '"></td>' +
        '<td class="p-2"><input type="number" class="field !py-1 !px-1.5 w-16 bg-transparent border-transparent hover:border-line focus:bg-panel" value="' + (it.qty || 1) + '" data-inv-field="qty" data-inv-id="' + it.id + '"></td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-inv-field]').forEach(el => {
      el.addEventListener('change', () => {
        const id = el.getAttribute('data-inv-id');
        const field = el.getAttribute('data-inv-field');
        
        if (field === 'category' && el.value === '--add--') {
          const catName = prompt('Enter new category name:');
          if (catName && catName.trim()) {
            const item = store.find('inventory', id);
            if (item) {
              item[field] = catName.trim();
              store.upsert('inventory', item);
            }
            renderInventory();
            return;
          } else {
            const item = store.find('inventory', id);
            el.value = item ? item.category : (getCategories()[0] || '');
            return;
          }
        }
        
        const val = el.type === 'number' ? parseInt(el.value, 10) || 1 : el.value;
        const item = store.find('inventory', id);
        if (item) {
          item[field] = val;
          store.upsert('inventory', item);
        }
      });
    });

    tbody.querySelectorAll('.v-inv-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.getAttribute('data-id');
        if (chk.checked) m.invSelected.add(id);
        else m.invSelected.delete(id);
        updateInvSelectionUI();
      });
    });
  }

  RMTP.views.venues = function(el) {
    m.root = el;
    render();
  };
})();
