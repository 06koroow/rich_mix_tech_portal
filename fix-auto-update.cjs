const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const spaceChangeRegex = /    const spSelect = m\.root\.querySelector\('#ps-space'\);\n    if \(spSelect\) \{\n      spSelect\.addEventListener\('change', \(\) => \{\n        sheet\.space = spSelect\.value;\n        if \(confirm\('Pull Room I\/O and Stagebox configuration from ' \+ spSelect\.value \+ ' venue settings\? \(This will overwrite current Home Run setup\)'\)\) \{\n          applyVenueRoomIO\(spSelect\.value, true\);\n          ui\.toast\('Applied Venue I\/O defaults for ' \+ spSelect\.value, 'ok'\);\n        \}\n      \}\);\n    \}/;

const spaceChangeNew = `    const spSelect = m.root.querySelector('#ps-space');
    if (spSelect) {
      spSelect.addEventListener('change', () => {
        sheet.space = spSelect.value;
        applyVenueRoomIO(spSelect.value, true);
        ui.toast('Applied Venue I/O defaults for ' + spSelect.value, 'ok');
      });
    }`;

code = code.replace(spaceChangeRegex, spaceChangeNew);

const eventChangeRegex = /            if \(linkedEv\.space\) \{\n              sheet\.space = linkedEv\.space;\n              const spEl = m\.root\.querySelector\('#ps-space'\);\n              if \(spEl\) spEl\.value = linkedEv\.space;\n            \}/;

const eventChangeNew = `            if (linkedEv.space) {
              sheet.space = linkedEv.space;
              const spEl = m.root.querySelector('#ps-space');
              if (spEl) spEl.value = linkedEv.space;
              applyVenueRoomIO(linkedEv.space, true);
            }`;

code = code.replace(eventChangeRegex, eventChangeNew);
fs.writeFileSync('js/views/presets.js', code);
console.log("Updated space changes");
