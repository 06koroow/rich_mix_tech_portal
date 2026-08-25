/* ============================================================
   presets.js — Input & Output Channel Patch Presets Manager
   ------------------------------------------------------------
   Allows technicians to build, customize, categorize, duplicate,
   and manage reusable input channel lists and output/monitor
   routing configurations for both act-level riders and global
   festival stage patches.
   ============================================================ */
RMTP.presets = (function () {
  const store = RMTP.store;
  const ui = RMTP.ui;

  const DEFAULT_INPUT_PRESETS = [
    {
      id: 'preset-inp-band-4pc',
      type: 'input',
      name: '4-Piece Band (Standard)',
      category: 'Band / Live',
      description: 'Standard 18-channel band setup with full mic kit, DI boxes, and backing vocals.',
      channels: [
        { channel: 1, instrument: 'Kick In', mic: 'Shure Beta 91A', stand: 'N/A', pos: 'Upstage Centre', phantom: true },
        { channel: 2, instrument: 'Kick Out', mic: 'Shure Beta 52', stand: 'Short Boom', pos: 'Upstage Centre', phantom: false },
        { channel: 3, instrument: 'Snare Top', mic: 'Shure SM57', stand: 'Short Boom', pos: 'Upstage Centre', phantom: false },
        { channel: 4, instrument: 'Snare Bottom', mic: 'Shure SM57', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { channel: 5, instrument: 'Hi-Hat', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Centre', phantom: true },
        { channel: 6, instrument: 'Rack Tom', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { channel: 7, instrument: 'Floor Tom', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { channel: 8, instrument: 'OH Left', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Left', phantom: true },
        { channel: 9, instrument: 'OH Right', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Right', phantom: true },
        { channel: 10, instrument: 'Bass DI', mic: 'Radial ProDI', stand: 'N/A', pos: 'Stage Right', phantom: false },
        { channel: 11, instrument: 'Bass Mic', mic: 'Sennheiser e906', stand: 'Short Boom', pos: 'Stage Right', phantom: false },
        { channel: 12, instrument: 'Gtr SL', mic: 'Shure SM57', stand: 'Short Boom', pos: 'Stage Left', phantom: false },
        { channel: 13, instrument: 'Gtr SR', mic: 'Sennheiser e906', stand: 'Short Boom', pos: 'Stage Right', phantom: false },
        { channel: 14, instrument: 'Keys L', mic: 'Radial ProD2', stand: 'N/A', pos: 'Stage Left', phantom: false },
        { channel: 15, instrument: 'Keys R', mic: 'Radial ProD2', stand: 'N/A', pos: 'Stage Left', phantom: false },
        { channel: 16, instrument: 'Lead Vox', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Centre Stage', phantom: false },
        { channel: 17, instrument: 'Backing Vox SL', mic: 'Shure SM58', stand: 'Tall Boom', pos: 'Stage Left', phantom: false },
        { channel: 18, instrument: 'Backing Vox SR', mic: 'Shure SM58', stand: 'Tall Boom', pos: 'Stage Right', phantom: false }
      ]
    },
    {
      id: 'preset-inp-acoustic-duo',
      type: 'input',
      name: 'Acoustic Duo / Trio',
      category: 'Acoustic',
      description: '5-channel setup for acoustic guitars, vocals, and cajon / percussion.',
      channels: [
        { channel: 1, instrument: 'Acoustic Gtr L', mic: 'Radial ProDI', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { channel: 2, instrument: 'Acoustic Gtr R', mic: 'Radial ProDI', stand: 'N/A', pos: 'Stage Right', phantom: false },
        { channel: 3, instrument: 'Vocal 1 (Lead)', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Centre Stage', phantom: false },
        { channel: 4, instrument: 'Vocal 2', mic: 'Shure SM58', stand: 'Tall Boom', pos: 'Stage Right', phantom: false },
        { channel: 5, instrument: 'Percussion / Cajon', mic: 'Shure Beta 91A', stand: 'N/A', pos: 'Upstage Centre', phantom: true }
      ]
    },
    {
      id: 'preset-inp-dj-playback',
      type: 'input',
      name: 'DJ / Club Playback',
      category: 'DJ / Club',
      description: 'Stereo DJ master feeds, booth line inputs, and wireless host MC mic.',
      channels: [
        { channel: 1, instrument: 'DJ Master L', mic: 'Radial ProD2', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { channel: 2, instrument: 'DJ Master R', mic: 'Radial ProD2', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { channel: 3, instrument: 'DJ Booth L', mic: 'Line In', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { channel: 4, instrument: 'DJ Booth R', mic: 'Line In', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { channel: 5, instrument: 'Host / MC Mic', mic: 'Wireless Handheld', stand: 'Straight Stand', pos: 'Downstage Centre', phantom: false }
      ]
    },
    {
      id: 'preset-inp-festival-16ch',
      type: 'input',
      name: '16ch Festival Patch',
      category: 'Festival / Stage',
      description: 'Comprehensive 16-channel festival core patch ready for rapid changeovers.',
      channels: [
        { channel: 1, instrument: 'Kick', mic: 'Shure Beta 52', stand: 'Short Boom', pos: 'Upstage Centre', phantom: false },
        { channel: 2, instrument: 'Snare', mic: 'Shure SM57', stand: 'Short Boom', pos: 'Upstage Centre', phantom: false },
        { channel: 3, instrument: 'Hi-Hat', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Centre', phantom: true },
        { channel: 4, instrument: 'Tom 1', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { channel: 5, instrument: 'Tom 2', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { channel: 6, instrument: 'Tom 3', mic: 'Sennheiser e604', stand: 'Claw / Clip', pos: 'Upstage Centre', phantom: false },
        { channel: 7, instrument: 'OH L', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Left', phantom: true },
        { channel: 8, instrument: 'OH R', mic: 'AKG C414', stand: 'Tall Boom', pos: 'Upstage Right', phantom: true },
        { channel: 9, instrument: 'Bass DI', mic: 'Radial ProDI', stand: 'N/A', pos: 'Stage Right', phantom: false },
        { channel: 10, instrument: 'Gtr 1', mic: 'Shure SM57', stand: 'Short Boom', pos: 'Stage Left', phantom: false },
        { channel: 11, instrument: 'Gtr 2', mic: 'Sennheiser e906', stand: 'Short Boom', pos: 'Stage Right', phantom: false },
        { channel: 12, instrument: 'Keys L', mic: 'Radial ProD2', stand: 'N/A', pos: 'Stage Left', phantom: false },
        { channel: 13, instrument: 'Keys R', mic: 'Radial ProD2', stand: 'N/A', pos: 'Stage Left', phantom: false },
        { channel: 14, instrument: 'Vox 1', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Downstage Left', phantom: false },
        { channel: 15, instrument: 'Vox 2 (Main)', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Downstage Centre', phantom: false },
        { channel: 16, instrument: 'Vox 3', mic: 'Shure Beta 58', stand: 'Tall Boom', pos: 'Downstage Right', phantom: false }
      ]
    },
    {
      id: 'preset-inp-corporate-speech',
      type: 'input',
      name: 'Panel & Corporate Speech',
      category: 'Corporate / AV',
      description: 'Lectern condenser, wireless handhelds, lavaliers, and stereo laptop audio feeds.',
      channels: [
        { channel: 1, instrument: 'Lectern Mic', mic: 'Gooseneck Condenser', stand: 'Lectern', pos: 'Downstage Right', phantom: true },
        { channel: 2, instrument: 'Wireless Handheld 1', mic: 'Shure QLXD Handheld', stand: 'Straight Stand', pos: 'Centre Stage', phantom: false },
        { channel: 3, instrument: 'Wireless Handheld 2', mic: 'Shure QLXD Handheld', stand: 'Straight Stand', pos: 'Centre Stage', phantom: false },
        { channel: 4, instrument: 'Wireless Lav 1', mic: 'Shure Bodypack / Lav', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { channel: 5, instrument: 'Wireless Lav 2', mic: 'Shure Bodypack / Lav', stand: 'N/A', pos: 'Centre Stage', phantom: false },
        { channel: 6, instrument: 'Laptop Audio L', mic: 'Radial USB-Pro', stand: 'N/A', pos: 'FOH / Control', phantom: false },
        { channel: 7, instrument: 'Laptop Audio R', mic: 'Radial USB-Pro', stand: 'N/A', pos: 'FOH / Control', phantom: false }
      ]
    },
    {
      id: 'preset-inp-horns-brass',
      type: 'input',
      name: 'Horn & Brass Section',
      category: 'Band / Live',
      description: '4-piece horn section with clip-on condensers and dynamic mics.',
      channels: [
        { channel: 1, instrument: 'Trumpet', mic: 'Shure Beta 57A', stand: 'Tall Boom', pos: 'Stage Left', phantom: false },
        { channel: 2, instrument: 'Tenor Sax', mic: 'Clip-on DPA 4099', stand: 'Claw / Clip', pos: 'Stage Left', phantom: true },
        { channel: 3, instrument: 'Alto Sax', mic: 'Clip-on DPA 4099', stand: 'Claw / Clip', pos: 'Stage Left', phantom: true },
        { channel: 4, instrument: 'Trombone', mic: 'Sennheiser MD421', stand: 'Tall Boom', pos: 'Stage Left', phantom: false }
      ]
    }
  ];

  const DEFAULT_OUTPUT_PRESETS = [
    {
      id: 'preset-out-wedges-4',
      type: 'output',
      name: '4 Stage Wedges',
      category: 'Monitors',
      description: 'Standard 4-way stage wedge mix (DSL, DSC, DSR, Drum Fill).',
      channels: [
        { num: 1, name: 'Mix 1 (DSL Wedge)', type: 'Wedge', dest: 'Downstage Left', stereo: false },
        { num: 2, name: 'Mix 2 (DSC Wedge)', type: 'Wedge', dest: 'Downstage Centre', stereo: false },
        { num: 3, name: 'Mix 3 (DSR Wedge)', type: 'Wedge', dest: 'Downstage Right', stereo: false },
        { num: 4, name: 'Mix 4 (Drum Fill)', type: 'Wedge', dest: 'Upstage Centre', stereo: false }
      ]
    },
    {
      id: 'preset-out-wedges-iem-6',
      type: 'output',
      name: '4 Wedges + 2 Stereo IEMs',
      category: 'Monitors',
      description: '4 discrete floor wedges plus 2 stereo wireless in-ear monitor transmitters.',
      channels: [
        { num: 1, name: 'Mix 1 (DSL Wedge)', type: 'Wedge', dest: 'Downstage Left', stereo: false },
        { num: 2, name: 'Mix 2 (DSC Wedge)', type: 'Wedge', dest: 'Downstage Centre', stereo: false },
        { num: 3, name: 'Mix 3 (DSR Wedge)', type: 'Wedge', dest: 'Downstage Right', stereo: false },
        { num: 4, name: 'Mix 4 (Drum Fill)', type: 'Wedge', dest: 'Upstage Centre', stereo: false },
        { num: 5, name: 'IEM 1 (Lead Vox)', type: 'IEM', dest: 'Transmitter 1 (Ch 1-2)', stereo: true },
        { num: 6, name: 'IEM 2 (MD / Keys)', type: 'IEM', dest: 'Transmitter 2 (Ch 3-4)', stereo: true }
      ]
    },
    {
      id: 'preset-out-iem-4pair',
      type: 'output',
      name: '4 Stereo IEM System',
      category: 'Monitors',
      description: 'Full 4-transmitter stereo IEM rig for silent stage band setups.',
      channels: [
        { num: 1, name: 'IEM 1 (Lead Vox)', type: 'IEM', dest: 'TX 1 (Ch 1-2)', stereo: true },
        { num: 2, name: 'IEM 2 (Guitars)', type: 'IEM', dest: 'TX 2 (Ch 3-4)', stereo: true },
        { num: 3, name: 'IEM 3 (Bass / MD)', type: 'IEM', dest: 'TX 3 (Ch 5-6)', stereo: true },
        { num: 4, name: 'IEM 4 (Drums)', type: 'IEM', dest: 'TX 4 (Ch 7-8)', stereo: true }
      ]
    },
    {
      id: 'preset-out-stream-matrix',
      type: 'output',
      name: 'FOH + Live Stream & Record',
      category: 'Broadcast / Recording',
      description: 'Dedicated matrices for broadcast stream, multi-track capture, and foyer hearing loop.',
      channels: [
        { num: 1, name: 'Mix 1 (Downstage Wedges)', type: 'Wedge', dest: 'Downstage Centre', stereo: false },
        { num: 2, name: 'Matrix 1-2 (Live Stream L/R)', type: 'Stream', dest: 'OBS / Blackmagic Switcher', stereo: true },
        { num: 3, name: 'Matrix 3-4 (Archival Record L/R)', type: 'Feed', dest: 'Audio Interface / DAW', stereo: true },
        { num: 4, name: 'Matrix 5 (Foyer / Bar Relay)', type: 'Feed', dest: '100V Line Amp', stereo: false },
        { num: 5, name: 'Matrix 6 (Hearing Loop)', type: 'Feed', dest: 'AFILS Amp', stereo: false }
      ]
    },
    {
      id: 'preset-out-dj-booth',
      type: 'output',
      name: 'DJ Booth & Club PA',
      category: 'DJ / Club',
      description: 'Stereo DJ booth monitors, Main PA feeds, and sub array drive.',
      channels: [
        { num: 1, name: 'Booth Monitors L/R', type: 'Wedge', dest: 'DJ Booth', stereo: true },
        { num: 2, name: 'Main PA Left / Right', type: 'Line Out', dest: 'System DSP', stereo: true },
        { num: 3, name: 'Subwoofer Array Feed', type: 'Line Out', dest: 'Sub Amps (Aux Fed)', stereo: false }
      ]
    }
  ];

  function getAll() {
    let list = store.read('patch_presets', null);
    if (!Array.isArray(list) || !list.length) {
      list = DEFAULT_INPUT_PRESETS.concat(DEFAULT_OUTPUT_PRESETS);
      store.write('patch_presets', list);
    }
    return list.slice();
  }

  function getInputs() {
    return getAll().filter((p) => p.type === 'input');
  }

  function getOutputs() {
    return getAll().filter((p) => p.type === 'output');
  }

  function get(id) {
    return getAll().find((p) => p.id === id) || null;
  }

  function save(preset) {
    const list = getAll();
    const idx = list.findIndex((p) => p.id === preset.id);
    if (idx > -1) {
      list[idx] = Object.assign({}, preset, { updatedAt: new Date().toISOString() });
    } else {
      list.push(Object.assign({ id: store.uid('pre'), createdAt: new Date().toISOString() }, preset));
    }
    store.write('patch_presets', list);
    return preset;
  }

  function remove(id) {
    const list = getAll().filter((p) => p.id !== id);
    store.write('patch_presets', list);
  }

  function resetDefaults() {
    const defaults = DEFAULT_INPUT_PRESETS.concat(DEFAULT_OUTPUT_PRESETS);
    store.write('patch_presets', defaults);
    return defaults;
  }

  /* Preset Builder Modal (can be invoked from view or anywhere in advancing) */
  function openEditorModal(presetOrNull, defaultType, onSaved) {
    const isEdit = !!(presetOrNull && presetOrNull.id);
    const type = (presetOrNull && presetOrNull.type) || defaultType || 'input';
    const isInput = type === 'input';

    let channels = (presetOrNull && Array.isArray(presetOrNull.channels))
      ? JSON.parse(JSON.stringify(presetOrNull.channels))
      : [];

    if (!channels.length) {
      if (isInput) {
        channels = [{ channel: 1, instrument: '', mic: '', stand: '', pos: '', phantom: false }];
      } else {
        channels = [{ num: 1, name: '', type: 'Wedge', dest: '', stereo: false }];
      }
    }

    const STAND_OPTIONS = ['N/A', 'Short Boom', 'Tall Boom', 'Straight Stand', 'Claw / Clip', 'Desk Stand', 'Lectern'];
    const POS_OPTIONS = ['Downstage Centre', 'Downstage Left', 'Downstage Right', 'Centre Stage', 'Stage Left', 'Stage Right', 'Upstage Centre', 'Upstage Left', 'Upstage Right', 'FOH / Control'];
    const OUT_TYPE_OPTIONS = ['Wedge', 'IEM', 'Fill', 'Line Out', 'Feed', 'Matrix', 'Stream'];

    function renderChannelsHtml() {
      if (isInput) {
        if (!channels.length) return '<div class="text-xs text-muted italic p-3 text-center bg-panel border border-line rounded">No channels added yet.</div>';
        return channels.map((ch, idx) => (
          '<div class="p-2 rounded-lg bg-panel border border-line flex flex-col gap-1.5 text-xs shadow-sm">' +
            '<div class="flex items-center justify-between gap-2">' +
              '<span class="font-mono font-bold text-accent text-xs">Ch ' + (ch.channel || (idx + 1)) + '</span>' +
              '<div class="flex items-center gap-1">' +
                '<label class="flex items-center gap-1 text-[11px] text-muted mr-2 cursor-pointer">' +
                  '<input type="checkbox" data-p-inp-48v="' + idx + '" class="w-3.5 h-3.5 accent-[var(--danger)]" ' + (ch.phantom ? 'checked' : '') + ' />' +
                  '<span class="' + (ch.phantom ? 'text-danger font-bold' : '') + '">+48V</span>' +
                '</label>' +
                '<button type="button" data-p-inp-up="' + idx + '" class="btn btn-ghost !p-1" title="Move Up" ' + (idx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3.5 h-3.5') + '</button>' +
                '<button type="button" data-p-inp-down="' + idx + '" class="btn btn-ghost !p-1" title="Move Down" ' + (idx === channels.length - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3.5 h-3.5') + '</button>' +
                '<button type="button" data-p-inp-del="' + idx + '" class="btn btn-danger !p-1" title="Delete Channel">' + ui.icon('trash', 'w-3.5 h-3.5') + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">' +
              '<div>' +
                '<label class="block text-[10px] text-muted mb-0.5">Instrument / Source</label>' +
                '<input data-p-inp-inst="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(ch.instrument || '') + '" placeholder="e.g. Kick, Lead Vox" />' +
              '</div>' +
              '<div>' +
                '<label class="block text-[10px] text-muted mb-0.5">Mic / DI Model</label>' +
                '<input data-p-inp-mic="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(ch.mic || '') + '" placeholder="e.g. Beta 58, ProDI" />' +
              '</div>' +
              '<div>' +
                '<label class="block text-[10px] text-muted mb-0.5">Stand</label>' +
                '<select data-p-inp-stand="' + idx + '" class="field !py-1 !px-1.5 text-xs">' +
                  '<option value="">Stand\u2026</option>' +
                  STAND_OPTIONS.map((s) => '<option ' + (s === ch.stand ? 'selected' : '') + '>' + s + '</option>').join('') +
                '</select>' +
              '</div>' +
              '<div>' +
                '<label class="block text-[10px] text-muted mb-0.5">Position</label>' +
                '<select data-p-inp-pos="' + idx + '" class="field !py-1 !px-1.5 text-xs">' +
                  '<option value="">Position\u2026</option>' +
                  POS_OPTIONS.map((p) => '<option ' + (p === ch.pos ? 'selected' : '') + '>' + p + '</option>').join('') +
                '</select>' +
              '</div>' +
            '</div>' +
          '</div>'
        )).join('');
      } else {
        if (!channels.length) return '<div class="text-xs text-muted italic p-3 text-center bg-panel border border-line rounded">No outputs added yet.</div>';
        return channels.map((out, idx) => (
          '<div class="p-2 rounded-lg bg-panel border border-line flex flex-col gap-1.5 text-xs shadow-sm">' +
            '<div class="flex items-center justify-between gap-2">' +
              '<div class="flex items-center gap-1.5">' +
                '<span class="font-mono font-bold text-accent text-xs">Out ' + (out.num || (idx + 1)) + '</span>' +
                (out.stereo ? '<span class="text-[10px] px-1 py-0.2 rounded bg-panel2 border border-info/40 text-info font-bold">STEREO</span>' : '') +
              '</div>' +
              '<div class="flex items-center gap-1">' +
                '<label class="flex items-center gap-1 text-[11px] text-muted mr-2 cursor-pointer">' +
                  '<input type="checkbox" data-p-out-stereo="' + idx + '" class="w-3.5 h-3.5 accent-[var(--info)]" ' + (out.stereo ? 'checked' : '') + ' />' +
                  '<span>Stereo Pair</span>' +
                '</label>' +
                '<button type="button" data-p-out-up="' + idx + '" class="btn btn-ghost !p-1" title="Move Up" ' + (idx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3.5 h-3.5') + '</button>' +
                '<button type="button" data-p-out-down="' + idx + '" class="btn btn-ghost !p-1" title="Move Down" ' + (idx === channels.length - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3.5 h-3.5') + '</button>' +
                '<button type="button" data-p-out-del="' + idx + '" class="btn btn-danger !p-1" title="Delete Output">' + ui.icon('trash', 'w-3.5 h-3.5') + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-1.5">' +
              '<div>' +
                '<label class="block text-[10px] text-muted mb-0.5">Label / Mix Name</label>' +
                '<input data-p-out-name="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(out.name || '') + '" placeholder="e.g. Mix 1 Lead Wedge" />' +
              '</div>' +
              '<div>' +
                '<label class="block text-[10px] text-muted mb-0.5">Type</label>' +
                '<select data-p-out-type="' + idx + '" class="field !py-1 !px-1.5 text-xs">' +
                  OUT_TYPE_OPTIONS.map((t) => '<option ' + (t === out.type ? 'selected' : '') + '>' + t + '</option>').join('') +
                '</select>' +
              '</div>' +
              '<div>' +
                '<label class="block text-[10px] text-muted mb-0.5">Destination / Stage Pos</label>' +
                '<input data-p-out-dest="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(out.dest || '') + '" placeholder="e.g. Downstage Left, TX 1" />' +
              '</div>' +
            '</div>' +
          '</div>'
        )).join('');
      }
    }

    const m = ui.modal({
      title: isEdit ? 'Edit ' + (isInput ? 'Input' : 'Output') + ' Preset' : 'New ' + (isInput ? 'Input' : 'Output') + ' Preset',
      size: 'md:max-w-3xl',
      body:
        '<div class="grid gap-4 text-xs">' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            '<div>' +
              '<label class="block text-xs font-semibold mb-1">Preset Name *</label>' +
              '<input id="p-name" class="field" value="' + ui.esc((presetOrNull && presetOrNull.name) || '') + '" placeholder="e.g. 5-Piece Rock Band, 4 Wedges + 2 IEMs" />' +
            '</div>' +
            '<div>' +
              '<label class="block text-xs font-semibold mb-1">Category</label>' +
              '<input id="p-category" list="preset-categories-list" class="field" value="' + ui.esc((presetOrNull && presetOrNull.category) || (isInput ? 'Band / Live' : 'Monitors')) + '" placeholder="e.g. Band / Live, Acoustic, DJ, Monitors" />' +
              '<datalist id="preset-categories-list">' +
                '<option value="Band / Live">' +
                '<option value="Acoustic">' +
                '<option value="DJ / Club">' +
                '<option value="Festival / Stage">' +
                '<option value="Monitors">' +
                '<option value="Broadcast / Recording">' +
                '<option value="Corporate / AV">' +
              '</datalist>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<label class="block text-xs font-semibold mb-1">Description / Notes</label>' +
            '<input id="p-desc" class="field" value="' + ui.esc((presetOrNull && presetOrNull.description) || '') + '" placeholder="Brief overview of who or what this patch is suited for" />' +
          '</div>' +

          '<div class="p-3 rounded-xl bg-panel2/40 border border-line flex flex-col gap-3">' +
            '<div class="flex items-center justify-between pb-2 border-b border-line/60">' +
              '<div class="flex items-center gap-2">' +
                '<span class="text-accent">' + ui.icon('sliders', 'w-4 h-4') + '</span>' +
                '<span class="font-bold text-ink uppercase tracking-wider text-xs">' + (isInput ? 'Channel Input Patch' : 'Output & Monitor Patch') + '</span>' +
                '<span id="p-chan-count-badge" class="font-mono text-[11px] px-2 py-0.5 rounded bg-panel border border-line text-accent font-semibold">' + channels.length + ' ' + (isInput ? 'Channels' : 'Outputs') + '</span>' +
              '</div>' +
              '<button type="button" id="btn-p-add-row" class="btn btn-primary !py-1 !px-2.5 text-xs flex items-center gap-1 font-semibold">' +
                ui.icon('plus', 'w-3.5 h-3.5') + '<span>' + (isInput ? 'Add Channel' : 'Add Output') + '</span>' +
              '</button>' +
            '</div>' +
            '<div id="p-channels-list" class="grid gap-2 max-h-80 overflow-y-auto pr-1"></div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary font-semibold" id="btn-p-save">Save Preset</button>'
    });

    function renumber() {
      channels.forEach((c, i) => {
        if (isInput) c.channel = i + 1;
        else c.num = i + 1;
      });
    }

    function wireChannels() {
      const listEl = m.root.querySelector('#p-channels-list');
      const countBadge = m.root.querySelector('#p-chan-count-badge');
      if (countBadge) countBadge.textContent = channels.length + ' ' + (isInput ? 'Channels' : 'Outputs');
      if (!listEl) return;
      listEl.innerHTML = renderChannelsHtml();

      if (isInput) {
        listEl.querySelectorAll('[data-p-inp-inst]').forEach((inp) => {
          inp.addEventListener('input', () => { channels[+inp.getAttribute('data-p-inp-inst')].instrument = inp.value; });
        });
        listEl.querySelectorAll('[data-p-inp-mic]').forEach((inp) => {
          inp.addEventListener('input', () => { channels[+inp.getAttribute('data-p-inp-mic')].mic = inp.value; });
        });
        listEl.querySelectorAll('[data-p-inp-stand]').forEach((sel) => {
          sel.addEventListener('change', () => { channels[+sel.getAttribute('data-p-inp-stand')].stand = sel.value; });
        });
        listEl.querySelectorAll('[data-p-inp-pos]').forEach((sel) => {
          sel.addEventListener('change', () => { channels[+sel.getAttribute('data-p-inp-pos')].pos = sel.value; });
        });
        listEl.querySelectorAll('[data-p-inp-48v]').forEach((chk) => {
          chk.addEventListener('change', () => { channels[+chk.getAttribute('data-p-inp-48v')].phantom = chk.checked; });
        });
        listEl.querySelectorAll('[data-p-inp-up]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = +btn.getAttribute('data-p-inp-up');
            if (idx > 0) {
              const t = channels[idx]; channels[idx] = channels[idx - 1]; channels[idx - 1] = t;
              renumber(); wireChannels();
            }
          });
        });
        listEl.querySelectorAll('[data-p-inp-down]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = +btn.getAttribute('data-p-inp-down');
            if (idx < channels.length - 1) {
              const t = channels[idx]; channels[idx] = channels[idx + 1]; channels[idx + 1] = t;
              renumber(); wireChannels();
            }
          });
        });
        listEl.querySelectorAll('[data-p-inp-del]').forEach((btn) => {
          btn.addEventListener('click', () => {
            channels.splice(+btn.getAttribute('data-p-inp-del'), 1);
            renumber(); wireChannels();
          });
        });
      } else {
        listEl.querySelectorAll('[data-p-out-name]').forEach((inp) => {
          inp.addEventListener('input', () => { channels[+inp.getAttribute('data-p-out-name')].name = inp.value; });
        });
        listEl.querySelectorAll('[data-p-out-type]').forEach((sel) => {
          sel.addEventListener('change', () => { channels[+sel.getAttribute('data-p-out-type')].type = sel.value; });
        });
        listEl.querySelectorAll('[data-p-out-dest]').forEach((inp) => {
          inp.addEventListener('input', () => { channels[+inp.getAttribute('data-p-out-dest')].dest = inp.value; });
        });
        listEl.querySelectorAll('[data-p-out-stereo]').forEach((chk) => {
          chk.addEventListener('change', () => { channels[+chk.getAttribute('data-p-out-stereo')].stereo = chk.checked; });
        });
        listEl.querySelectorAll('[data-p-out-up]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = +btn.getAttribute('data-p-out-up');
            if (idx > 0) {
              const t = channels[idx]; channels[idx] = channels[idx - 1]; channels[idx - 1] = t;
              renumber(); wireChannels();
            }
          });
        });
        listEl.querySelectorAll('[data-p-out-down]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = +btn.getAttribute('data-p-out-down');
            if (idx < channels.length - 1) {
              const t = channels[idx]; channels[idx] = channels[idx + 1]; channels[idx + 1] = t;
              renumber(); wireChannels();
            }
          });
        });
        listEl.querySelectorAll('[data-p-out-del]').forEach((btn) => {
          btn.addEventListener('click', () => {
            channels.splice(+btn.getAttribute('data-p-out-del'), 1);
            renumber(); wireChannels();
          });
        });
      }
    }

    const addRowBtn = m.root.querySelector('#btn-p-add-row');
    if (addRowBtn) {
      addRowBtn.addEventListener('click', () => {
        if (isInput) {
          channels.push({
            channel: channels.length + 1,
            instrument: '',
            mic: '',
            stand: '',
            pos: '',
            phantom: false
          });
        } else {
          channels.push({
            num: channels.length + 1,
            name: '',
            type: 'Wedge',
            dest: '',
            stereo: false
          });
        }
        wireChannels();
      });
    }

    wireChannels();

    m.root.querySelector('[data-cancel]').addEventListener('click', () => m.close());
    m.root.querySelector('#btn-p-save').addEventListener('click', () => {
      const name = (m.root.querySelector('#p-name').value || '').trim();
      if (!name) { ui.toast('Enter a preset name', 'danger'); return; }
      if (!channels.length) { ui.toast('Add at least one channel to the preset', 'danger'); return; }

      renumber();
      const saved = save({
        id: (presetOrNull && presetOrNull.id) || store.uid('pre'),
        type: type,
        name: name,
        category: (m.root.querySelector('#p-category').value || '').trim() || (isInput ? 'Band / Live' : 'Monitors'),
        description: (m.root.querySelector('#p-desc').value || '').trim(),
        channels: channels
      });

      m.close();
      ui.toast('Saved preset "' + name + '"', 'ok');
      if (typeof onSaved === 'function') onSaved(saved);
    });
  }

  /* Quick "Save current channels as new preset" dialog */
  function openSaveAsModal(type, currentChannels, onSaved) {
    if (!Array.isArray(currentChannels) || !currentChannels.length) {
      ui.toast('No channels configured to save as preset', 'danger');
      return;
    }
    const cleanChannels = JSON.parse(JSON.stringify(currentChannels));
    openEditorModal({
      id: null,
      type: type,
      name: '',
      category: type === 'input' ? 'Band / Live' : 'Monitors',
      description: '',
      channels: cleanChannels
    }, type, onSaved);
  }

  return {
    getAll,
    getInputs,
    getOutputs,
    get,
    save,
    remove,
    resetDefaults,
    openEditorModal,
    openSaveAsModal
  };
})();

/* ============================================================
   RMTP.views.presets — Main Presets Management Page
   ============================================================ */
RMTP.views.presets = function (contentEl) {
  const ui = RMTP.ui;
  const presetsApi = RMTP.presets;

  let activeTab = 'all'; // 'all', 'input', 'output'
  let searchQuery = '';

  function render() {
    const allPresets = presetsApi.getAll();
    const filtered = allPresets.filter((p) => {
      if (activeTab === 'input' && p.type !== 'input') return false;
      if (activeTab === 'output' && p.type !== 'output') return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const inName = (p.name || '').toLowerCase().includes(q);
        const inCat = (p.category || '').toLowerCase().includes(q);
        const inDesc = (p.description || '').toLowerCase().includes(q);
        const inCh = Array.isArray(p.channels) && p.channels.some((c) =>
          ((c.instrument || '') + ' ' + (c.mic || '') + ' ' + (c.name || '') + ' ' + (c.dest || '')).toLowerCase().includes(q)
        );
        if (!inName && !inCat && !inDesc && !inCh) return false;
      }
      return true;
    });

    const inputCount = allPresets.filter((p) => p.type === 'input').length;
    const outputCount = allPresets.filter((p) => p.type === 'output').length;

    contentEl.innerHTML =
      '<div class="grid gap-6">' +
        // Page Header
        '<div class="flex flex-wrap items-center justify-between gap-3">' +
          '<div>' +
            '<h2 class="text-2xl font-bold tracking-tight text-ink">Patch Presets Manager</h2>' +
            '<p class="text-sm text-muted">Build, edit and maintain input channel patches and monitor routing presets for live acts and festival setups.</p>' +
          '</div>' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<button id="btn-new-inp-preset" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5">' +
              ui.icon('plus', 'w-4 h-4') + '<span>+ New Input Preset</span>' +
            '</button>' +
            '<button id="btn-new-out-preset" class="btn btn-primary text-xs font-semibold flex items-center gap-1.5">' +
              ui.icon('plus', 'w-4 h-4') + '<span>+ New Output Preset</span>' +
            '</button>' +
            '<button id="btn-reset-presets" class="btn btn-ghost text-xs text-muted hover:text-ink flex items-center gap-1" title="Restore factory venue presets">' +
              ui.icon('reset', 'w-3.5 h-3.5') + '<span>Reset Defaults</span>' +
            '</button>' +
          '</div>' +
        '</div>' +

        // Toolbar & Filter Tabs
        '<div class="panel p-4 flex flex-wrap items-center justify-between gap-3">' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<button data-tab="all" class="px-3 py-1.5 rounded-lg text-xs font-semibold border ' + (activeTab === 'all' ? 'bg-accent text-accent-ink border-accent' : 'bg-panel2 border-line text-muted hover:text-ink') + '">' +
              'All Presets (' + allPresets.length + ')' +
            '</button>' +
            '<button data-tab="input" class="px-3 py-1.5 rounded-lg text-xs font-semibold border ' + (activeTab === 'input' ? 'bg-accent text-accent-ink border-accent' : 'bg-panel2 border-line text-muted hover:text-ink') + '">' +
              'Input Patches (' + inputCount + ')' +
            '</button>' +
            '<button data-tab="output" class="px-3 py-1.5 rounded-lg text-xs font-semibold border ' + (activeTab === 'output' ? 'bg-accent text-accent-ink border-accent' : 'bg-panel2 border-line text-muted hover:text-ink') + '">' +
              'Output / Monitors (' + outputCount + ')' +
            '</button>' +
          '</div>' +
          '<div class="relative w-full sm:w-64">' +
            '<span class="absolute inset-y-0 left-0 pl-2.5 flex items-center text-muted pointer-events-none">' + ui.icon('search', 'w-4 h-4') + '</span>' +
            '<input id="presets-search" class="field !py-1.5 !pl-8 text-xs w-full" placeholder="Search instruments, mics, labels\u2026" value="' + ui.esc(searchQuery) + '" />' +
          '</div>' +
        '</div>' +

        // Presets Grid
        (!filtered.length ? (
          '<div class="panel p-12 text-center text-muted flex flex-col items-center justify-center gap-3">' +
            '<div class="w-12 h-12 rounded-full bg-panel2 flex items-center justify-center text-muted">' + ui.icon('sliders', 'w-6 h-6') + '</div>' +
            '<p class="text-sm font-medium text-ink">No presets found</p>' +
            '<p class="text-xs max-w-sm">No patch presets matched your search filter. Create a new preset or reset defaults.</p>' +
          '</div>'
        ) : (
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
            filtered.map((p) => {
              const isInput = p.type === 'input';
              const chCount = Array.isArray(p.channels) ? p.channels.length : 0;
              const chPreview = (p.channels || []).slice(0, 6).map((c) => {
                if (isInput) {
                  return '<span class="px-1.5 py-0.5 rounded bg-panel border border-line text-[10px] font-mono">' +
                    '#' + (c.channel || '') + ' ' + ui.esc(c.instrument || 'In') + (c.phantom ? ' <b class="text-danger">+48V</b>' : '') +
                  '</span>';
                } else {
                  return '<span class="px-1.5 py-0.5 rounded bg-panel border border-line text-[10px] font-mono">' +
                    'Out ' + (c.num || '') + ': ' + ui.esc(c.name || c.dest || 'Mix') +
                  '</span>';
                }
              }).join('');

              return (
                '<div class="panel p-5 flex flex-col justify-between gap-4 border border-line hover:border-accent/50 transition-colors shadow-sm relative group">' +
                  '<div>' +
                    '<div class="flex items-start justify-between gap-2 mb-2">' +
                      '<div>' +
                        '<div class="flex items-center gap-2 mb-1">' +
                          '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono border ' + (isInput ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-info/15 border-info/40 text-info') + '">' +
                            (isInput ? 'Input Patch' : 'Output Patch') +
                          '</span>' +
                          '<span class="px-2 py-0.5 rounded bg-panel2 border border-line text-[10px] text-muted">' + ui.esc(p.category || 'General') + '</span>' +
                        '</div>' +
                        '<h3 class="text-base font-bold text-ink">' + ui.esc(p.name) + '</h3>' +
                      '</div>' +
                      '<span class="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-panel2 border border-line text-ink shrink-0">' +
                        chCount + ' ' + (isInput ? 'Ch' : 'Out') +
                      '</span>' +
                    '</div>' +
                    (p.description ? '<p class="text-xs text-muted mb-3 leading-relaxed">' + ui.esc(p.description) + '</p>' : '') +
                    '<div class="flex flex-wrap gap-1.5 pt-2 border-t border-line/60">' +
                      chPreview +
                      (chCount > 6 ? '<span class="text-[10px] text-muted self-center font-mono">+' + (chCount - 6) + ' more\u2026</span>' : '') +
                    '</div>' +
                  '</div>' +

                  '<div class="flex items-center justify-between pt-3 border-t border-line/60 gap-2">' +
                    '<div class="text-[11px] text-muted font-mono">' +
                      (isInput ? 'Phantom, Mic, Stand, Pos' : 'Wedges, IEMs, Routing') +
                    '</div>' +
                    '<div class="flex items-center gap-1.5">' +
                      '<button data-pre-dup="' + p.id + '" class="btn btn-ghost !py-1 !px-2 text-xs flex items-center gap-1" title="Duplicate">' +
                        ui.icon('plus', 'w-3 h-3') + '<span>Duplicate</span>' +
                      '</button>' +
                      '<button data-pre-edit="' + p.id + '" class="btn btn-primary !py-1 !px-2.5 text-xs font-semibold flex items-center gap-1">' +
                        ui.icon('pen', 'w-3 h-3') + '<span>Edit</span>' +
                      '</button>' +
                      '<button data-pre-del="' + p.id + '" class="btn btn-danger !p-1.5" title="Delete preset">' +
                        ui.icon('trash', 'w-3.5 h-3.5') +
                      '</button>' +
                    '</div>' +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>'
        )) +
      '</div>';

    // Event listeners
    contentEl.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        render();
      });
    });

    const searchInp = contentEl.querySelector('#presets-search');
    if (searchInp) {
      searchInp.addEventListener('input', () => {
        searchQuery = searchInp.value.trim();
        render();
      });
    }

    const newInpBtn = contentEl.querySelector('#btn-new-inp-preset');
    if (newInpBtn) newInpBtn.addEventListener('click', () => presetsApi.openEditorModal(null, 'input', () => render()));

    const newOutBtn = contentEl.querySelector('#btn-new-out-preset');
    if (newOutBtn) newOutBtn.addEventListener('click', () => presetsApi.openEditorModal(null, 'output', () => render()));

    const resetBtn = contentEl.querySelector('#btn-reset-presets');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Reset all presets to factory venue defaults? Custom additions will be overwritten.')) {
          presetsApi.resetDefaults();
          ui.toast('Restored venue default presets', 'ok');
          render();
        }
      });
    }

    contentEl.querySelectorAll('[data-pre-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pre-edit');
        const p = presetsApi.get(id);
        if (p) presetsApi.openEditorModal(p, p.type, () => render());
      });
    });

    contentEl.querySelectorAll('[data-pre-dup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pre-dup');
        const p = presetsApi.get(id);
        if (p) {
          const dup = JSON.parse(JSON.stringify(p));
          dup.id = null;
          dup.name = p.name + ' (Copy)';
          presetsApi.openEditorModal(dup, dup.type, () => render());
        }
      });
    });

    contentEl.querySelectorAll('[data-pre-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pre-del');
        const p = presetsApi.get(id);
        if (p && confirm('Delete preset "' + p.name + '"?')) {
          presetsApi.remove(id);
          ui.toast('Deleted preset', 'ok');
          render();
        }
      });
    });
  }

  render();
};
