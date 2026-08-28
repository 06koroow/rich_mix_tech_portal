const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

// 1. Add "Add Space" to sidebar
const sidebarCode = `'</div>' +
          '<div class="flex-1 overflow-y-auto p-2 space-y-1">' +
            spaces.map(sp => {`;
const newSidebarCode = `'</div>' +
          '<div class="flex-1 overflow-y-auto p-2 space-y-1">' +
            spaces.map(sp => {`;
// wait, I'll just replace the end of the sidebar div
code = code.replace(
  /            \}\)\.join\(''\) \+\n\s*'<\/div>' \+\n\s*'<\/div>' \+/,
  `            }).join('') +
          '</div>' +
          (RMTP.auth.current() && RMTP.auth.current().admin ? '<div class="p-3 border-t border-line"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button></div>' : '') +
        '</div>' +`
);

// 2. Add "Delete Space" to right header
code = code.replace(
  /              '<button class="btn btn-ghost border border-line btn-sm flex items-center gap-1.5 shadow-sm" onclick="alert\\(\\'Printing Venue Specs to PDF...\\'\\)">' \+\n\s*ui\.icon\('printer', 'w-4 h-4'\) \+ ' Print Tech Spec' \+\n\s*'<\/button>' \+\n\s*'<\/div>' \+/,
  `              '<button class="btn btn-ghost border border-line btn-sm flex items-center gap-1.5 shadow-sm" onclick="alert(\\'Printing Venue Specs to PDF...\\')">' +
                ui.icon('printer', 'w-4 h-4') + ' Print Tech Spec' +
              '</button>' +
              (RMTP.auth.current() && RMTP.auth.current().admin && m.activeSpace ? 
              '<button id="btn-delete-space" class="btn btn-danger btn-sm flex items-center gap-1.5 shadow-sm" title="Delete Space">' + ui.icon('trash', 'w-4 h-4') + ' Delete</button>' : '') +
            '</div>' +`
);

fs.writeFileSync('js/views/venues.js', code);
console.log("Patched venues HTML");
