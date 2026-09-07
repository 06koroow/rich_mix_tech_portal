const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

const oldHeader = `'<div class="px-4 md:px-6 py-4 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-3 bg-panel/50 backdrop-blur sticky top-0 z-10">' +
            '<h1 class="text-xl font-display font-bold">' + ui.esc(m.activeSpace || 'Select a Venue') + '</h1>' +
            '<div class="flex flex-wrap gap-2">' +
              '<button id="btn-save-venue" class="btn btn-primary btn-sm flex items-center gap-1.5 shadow-sm">' +
                ui.icon('check', 'w-4 h-4') + ' Save Changes' +
              '</button>' +
              '<button class="btn btn-ghost border border-line btn-sm flex items-center gap-1.5 shadow-sm" onclick="alert(\\'Printing Venue Specs to PDF...\\')">' +
                ui.icon('printer', 'w-4 h-4') + ' Print Tech Spec' +
              '</button>' +
              (RMTP.auth.current() && RMTP.auth.current().admin && m.activeSpace ? 
              '<button id="btn-delete-space" class="btn btn-danger btn-sm flex items-center gap-1.5 shadow-sm" title="Delete Space">' + ui.icon('trash', 'w-4 h-4') + ' Delete Space</button>' : '') +
            '</div>' +
          '</div>'`;

const newHeader = `'<div class="px-4 md:px-6 py-3 md:py-4 border-b border-line flex items-center justify-between gap-2 md:gap-3 bg-panel/50 backdrop-blur sticky top-0 z-10">' +
            '<h1 class="text-lg md:text-xl font-display font-bold truncate pr-2">' + ui.esc(m.activeSpace || 'Select a Venue') + '</h1>' +
            '<div class="flex items-center gap-1.5 md:gap-2 shrink-0">' +
              '<button id="btn-save-venue" class="btn btn-primary btn-sm flex items-center justify-center gap-1.5 shadow-sm !p-1.5 md:!px-3 md:!py-1.5 aspect-square md:aspect-auto" title="Save Changes">' +
                ui.icon('check', 'w-4 h-4') + '<span class="hidden md:inline">Save</span>' +
              '</button>' +
              '<button class="btn btn-ghost border border-line btn-sm flex items-center justify-center gap-1.5 shadow-sm !p-1.5 md:!px-3 md:!py-1.5 aspect-square md:aspect-auto" onclick="alert(\\'Printing Venue Specs to PDF...\\')" title="Print Tech Spec">' +
                ui.icon('printer', 'w-4 h-4') + '<span class="hidden md:inline">Print</span>' +
              '</button>' +
              (RMTP.auth.current() && RMTP.auth.current().admin && m.activeSpace ? 
              '<button id="btn-delete-space" class="btn btn-danger btn-sm flex items-center justify-center gap-1.5 shadow-sm !p-1.5 md:!px-3 md:!py-1.5 aspect-square md:aspect-auto" title="Delete Space">' + ui.icon('trash', 'w-4 h-4') + '<span class="hidden md:inline">Delete</span></button>' : '') +
            '</div>' +
          '</div>'`;

if (code.includes(oldHeader)) {
  fs.writeFileSync('js/views/venues.js', code.replace(oldHeader, newHeader));
  console.log('Successfully patched header!');
} else {
  console.log('Failed to find oldHeader. Check strings.');
}
