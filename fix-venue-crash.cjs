const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

const target1 = `    bindInput('#v-capacity', m.venueData, 'capacity');`;
const replacement1 = `    if (m.venueData) {
      bindInput('#v-capacity', m.venueData, 'capacity');`;
code = code.replace(target1, replacement1);

const target2 = `    m.root.querySelectorAll('[data-fx-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.getAttribute('data-fx-del');
        m.venueData.dmx.splice(idx, 1);
        render();
      });
    });`;
const replacement2 = target2 + "\n    }";

code = code.replace(target2, replacement2);

fs.writeFileSync('js/views/venues.js', code);
console.log("Patched string replace");
