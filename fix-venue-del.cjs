const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

const target = `'<button class="btn btn-ghost border border-line btn-sm flex items-center gap-1.5 shadow-sm" onclick="alert(\\'Printing Venue Specs to PDF...\\')">' +
                ui.icon('printer', 'w-4 h-4') + ' Print Tech Spec' +
              '</button>' +
            '</div>' +`;

const replacement = `'<button class="btn btn-ghost border border-line btn-sm flex items-center gap-1.5 shadow-sm" onclick="alert(\\'Printing Venue Specs to PDF...\\')">' +
                ui.icon('printer', 'w-4 h-4') + ' Print Tech Spec' +
              '</button>' +
              (RMTP.auth.current() && RMTP.auth.current().admin && m.activeSpace ? 
              '<button id="btn-delete-space" class="btn btn-danger btn-sm flex items-center gap-1.5 shadow-sm" title="Delete Space">' + ui.icon('trash', 'w-4 h-4') + ' Delete Space</button>' : '') +
            '</div>' +`;

code = code.replace(target, replacement);
fs.writeFileSync('js/views/venues.js', code);
console.log("Patched delete button html");
