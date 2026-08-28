const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetButtons = `                        (channelInputs.length ? '<button type="button" id="btn-clear-input-chan" class="btn btn-danger !py-0.5 !px-1.5 text-[10px]" title="Clear Inputs">Clear</button>' : '') +`;
const replacementButtons = `                        (channelInputs.length ? '<button type="button" id="btn-auto-patch-inputs" class="btn btn-secondary !py-0.5 !px-1.5 text-[10px]" title="Overlay and allocate to House Patch">Auto-Patch</button><button type="button" id="btn-clear-input-chan" class="btn btn-danger !py-0.5 !px-1.5 text-[10px]" title="Clear Inputs">Clear</button>' : '') +`;
code = code.replace(targetButtons, replacementButtons);

const targetGrid = `          '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' +`;
const replacementGrid = `          '<div class="grid grid-cols-2 sm:grid-cols-5 gap-2">' +
            '<div>' +
              '<input list="inp-patch-presets" data-inp-patch="' + idx + '" class="field !py-1 !px-2 text-xs" value="' + ui.esc(ch.patch || '') + '" placeholder="Patch (e.g. A1)" />' +
            '</div>' +`;
code = code.replace(targetGrid, replacementGrid);

const targetDatalist = `      '<datalist id="inp-mic-presets">' + INPUT_MIC_PRESETS.map((p) => '<option value="' + p + '"></option>').join('') + '</datalist>';`;
const replacementDatalist = `      '<datalist id="inp-mic-presets">' + INPUT_MIC_PRESETS.map((p) => '<option value="' + p + '"></option>').join('') + '</datalist>' +
      '<datalist id="inp-patch-presets">' + patchOptions.map((p) => '<option value="' + p + '"></option>').join('') + '</datalist>';`;
code = code.replace(targetDatalist, replacementDatalist);

const targetVars = `    let linkedMaintIds = Array.isArray(ev.linked_maintenance_ids || ev.linkedMaintenanceIds)
      ? (ev.linked_maintenance_ids || ev.linkedMaintenanceIds).slice()
      : (ev._preselectedFaultId ? [ev._preselectedFaultId] : []);`;
const replacementVars = targetVars + `

    let patchOptions = [];
    const venue = store.all('venues').find(vv => vv.name === ev.space);
    if (venue && venue.audio) {
      if (venue.audio.localInputChannels) {
        for(let i=1; i<=venue.audio.localInputChannels; i++) patchOptions.push('Local ' + i);
      }
      if (venue.audio.stageboxes) {
        venue.audio.stageboxes.forEach(sb => {
          let limit = sb.analogIn || 0;
          for(let i=1; i<=limit; i++) patchOptions.push((sb.letter || sb.name || 'SB') + i);
        });
      }
    }`;
code = code.replace(targetVars, replacementVars);

const targetEvents = `      container.querySelectorAll('[data-inp-inst]').forEach((inp) => {`;
const replacementEvents = `      container.querySelectorAll('[data-inp-patch]').forEach((inp) => {
        inp.addEventListener('input', () => { channelInputs[+inp.getAttribute('data-inp-patch')].patch = inp.value; });
      });
      container.querySelectorAll('[data-inp-inst]').forEach((inp) => {`;
code = code.replace(targetEvents, replacementEvents);

const targetAutoBtn = `    const clearInputBtn = m.root.querySelector('#btn-clear-input-chan');`;
const replacementAutoBtn = `    const autoPatchBtn = m.root.querySelector('#btn-auto-patch-inputs');
    if (autoPatchBtn) {
      autoPatchBtn.addEventListener('click', () => {
        let patchIndex = 0;
        channelInputs.forEach((ch, idx) => {
          if (!ch.patch && patchIndex < patchOptions.length) {
            ch.patch = patchOptions[patchIndex];
            patchIndex++;
          }
        });
        renderChannelInputs();
        ui.toast('Auto-allocated channels to house patch', 'ok');
      });
    }

    const clearInputBtn = m.root.querySelector('#btn-clear-input-chan');`;
code = code.replace(targetAutoBtn, replacementAutoBtn);

fs.writeFileSync('js/views/advancing.js', code);
console.log("Patched advancing.js");
