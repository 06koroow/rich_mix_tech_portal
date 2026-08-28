const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetButtons = `(inCount ? '<button type="button" data-act-clear-input="' + idx + '" class="btn btn-danger !py-0.5 !px-1.5 text-[10px]" title="Clear Inputs">Clear</button>' : '')`;
const replacementButtons = `(inCount ? '<button type="button" data-act-autopatch="' + idx + '" class="btn btn-secondary !py-0.5 !px-1.5 text-[10px]" title="Auto-Patch to House">Auto-Patch</button><button type="button" data-act-clear-input="' + idx + '" class="btn btn-danger !py-0.5 !px-1.5 text-[10px]" title="Clear Inputs">Clear</button>' : '')`;
code = code.replace(targetButtons, replacementButtons);

const targetGrid = `'<div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">' +
                                '<input list="inp-inst-presets" data-act-ch-inst="' + idx + '-' + chIdx + '" class="field !py-0.5 !px-1.5 text-xs" value="' + ui.esc(ch.instrument || '') + '" placeholder="Instrument (e.g. Kick)" />' +`;
const replacementGrid = `'<div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5">' +
                                '<input list="inp-patch-presets" data-act-ch-patch="' + idx + '-' + chIdx + '" class="field !py-0.5 !px-1.5 text-xs" value="' + ui.esc(ch.patch || '') + '" placeholder="Patch (e.g. A1)" />' +
                                '<input list="inp-inst-presets" data-act-ch-inst="' + idx + '-' + chIdx + '" class="field !py-0.5 !px-1.5 text-xs" value="' + ui.esc(ch.instrument || '') + '" placeholder="Instrument (e.g. Kick)" />' +`;
code = code.replace(targetGrid, replacementGrid);

fs.writeFileSync('js/views/advancing.js', code);
console.log("Patched schedule act inputs UI");
