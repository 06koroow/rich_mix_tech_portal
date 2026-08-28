const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

const injection = `    const spaces = RMTP.SPACES || [];
    if (!m.activeSpace && spaces.length > 0) {
      m.activeSpace = spaces[0];
      loadVenueData();
    }
    
    if (spaces.length === 0) {
      m.root.innerHTML = '<div class="flex h-[calc(100vh-100px)] border border-line rounded-xl bg-panel overflow-hidden shadow-sm">' +
        '<div class="w-64 border-r border-line bg-panel2/30 flex flex-col">' +
          '<div class="p-3 border-b border-line"><h2 class="font-display font-semibold text-sm">Venues & Spaces</h2></div>' +
          '<div class="flex-1 p-4 text-sm text-muted italic">No spaces configured.</div>' +
          (RMTP.auth.current() && RMTP.auth.current().admin ? '<div class="p-3 border-t border-line"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button></div>' : '') +
        '</div>' +
        '<div class="flex-1 flex items-center justify-center text-muted italic">Please add a space to continue.</div>' +
      '</div>';
      attachEvents();
      return;
    }`;

code = code.replace(/    const spaces = RMTP\.SPACES \|\| \[\];\n\s*if \(\!m\.activeSpace && spaces\.length > 0\) \{\n\s*m\.activeSpace = spaces\[0\];\n\s*loadVenueData\(\);\n\s*\}/, injection);

fs.writeFileSync('js/views/venues.js', code);
console.log("Patched empty spaces state");
