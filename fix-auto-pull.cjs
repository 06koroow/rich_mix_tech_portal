const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const regex = /if \(nameEl && \(\!nameEl\.value \|\| nameEl\.value\.trim\(\) === 'Event Patch Sheet' \|\| nameEl\.value\.trim\(\) === 'New Event Patch Sheet'\)\) \{\n\s*nameEl\.value = \(linkedEv\.name \|\| 'Event'\) \+ ' — Stagebox Patch Plan';\n\s*sheet\.name = nameEl\.value;\n\s*\}/;

const replacement = `if (nameEl && (!nameEl.value || nameEl.value.trim() === 'Event Patch Sheet' || nameEl.value.trim() === 'New Event Patch Sheet')) {
              nameEl.value = (linkedEv.name || 'Event') + ' — Stagebox Patch Plan';
              sheet.name = nameEl.value;
            }
            if (sheet.acts.length <= 1) {
              syncArtistsFromEvent(sheet, linkedEv, true);
            }`;

if (code.match(regex)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('js/views/presets.js', code);
    console.log("Added auto-pull of artists when event is linked and acts are empty");
} else {
    console.log("Failed to match regex for auto-pull");
}
