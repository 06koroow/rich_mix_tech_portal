const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const regexUi = /'<button type="button" id="btn-add-custom-sb" class="btn btn-primary !py-1 !px-2\.5 text-xs flex items-center gap-1 font-semibold">' \+\n\s*ui\.icon\('plus', 'w-3\.5 h-3\.5'\) \+ '<span>Custom Box<\/span>' \+\n\s*'<\/button>' \+/;

const replacementUi = `'<button type="button" id="btn-add-local-sb" class="btn btn-ghost !py-1 !px-2.5 text-xs text-accent border border-line flex items-center gap-1 font-semibold" title="Add stagebox representing Local I/O from the Mixing Console">' +
                  ui.icon('plus', 'w-3 h-3') + '<span>Local Desk I/O</span>' +
                '</button>' +
                '<button type="button" id="btn-add-custom-sb" class="btn btn-primary !py-1 !px-2.5 text-xs flex items-center gap-1 font-semibold">' +
                  ui.icon('plus', 'w-3.5 h-3.5') + '<span>Custom Box</span>' +
                '</button>' +`;

if (code.match(regexUi)) {
    code = code.replace(regexUi, replacementUi);
    console.log("Added UI button.");
} else {
    console.log("Failed to match UI regex.");
}

const regexEvents = /const addCustomBtn = m\.root\.querySelector\('#btn-add-custom-sb'\);/;

const replacementEvents = `const addLocalBtn = m.root.querySelector('#btn-add-local-sb');
    if (addLocalBtn) {
      addLocalBtn.addEventListener('click', () => {
        const letter = 'L'; // L for local
        const inCap = sheet.homeRun.localInputChannels || 8;
        const outCap = sheet.homeRun.localOutputChannels || 8;
        sheet.stageboxes.push({
          id: store.uid('sb'),
          letter: letter,
          name: 'Local Desk I/O',
          location: 'FOH',
          capacity: inCap,
          outCapacity: outCap,
          channels: Array.from({ length: inCap }, (_, i) => ({
            socket: i + 1,
            actId: sheet.acts[0] ? sheet.acts[0].id : 'act-house',
            instrument: '',
            mic: '',
            phantom: false,
            repatch: false,
            repatchTo: '',
            homeRunCh: null
          })),
          outputs: Array.from({ length: outCap }, (_, i) => ({
            socket: i + 1,
            destination: ''
          }))
        });
        renderStageboxes();
      });
    }

    const addCustomBtn = m.root.querySelector('#btn-add-custom-sb');`;

if (code.match(regexEvents)) {
    code = code.replace(regexEvents, replacementEvents);
    console.log("Added events.");
} else {
    console.log("Failed to match events regex.");
}

fs.writeFileSync('js/views/presets.js', code);
