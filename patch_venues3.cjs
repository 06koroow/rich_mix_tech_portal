const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

// Patch empty state sidebar
code = code.replace(
  /'<div class="w-full md:w-64 border-b md:border-b-0 md:border-r border-line bg-panel2\/30 flex flex-col shrink-0 max-h-\[35vh\] md:max-h-none overflow-y-auto">'\s*\+\s*'<div class="p-3 border-b border-line"><h2 class="font-display font-semibold text-sm">Venues & Spaces<\/h2><\/div>'\s*\+\s*'<div class="flex-1 p-4 text-sm text-muted italic">No spaces configured\.<\/div>'\s*\+\s*'<div class="p-3 border-t border-line"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1\.5">' \+ ui\.icon\('plus', 'w-3 h-3'\) \+ ' Add Space<\/button><\/div>'\s*\+\s*'<\/div>'/g,
  `'<div class="w-full md:w-64 border-b md:border-b-0 md:border-r border-line bg-panel2/30 flex flex-col shrink-0">' +
          '<div class="hidden md:block p-3 border-b border-line"><h2 class="font-display font-semibold text-sm">Venues & Spaces</h2></div>' +
          '<div class="flex-1 flex items-center justify-center p-3 md:p-4 text-sm text-muted italic">No spaces configured.</div>' +
          '<div class="p-3 border-t border-line"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button></div>' +
        '</div>'`
);

// Patch loaded state sidebar
code = code.replace(
  /'<div class="w-full md:w-64 border-b md:border-b-0 md:border-r border-line bg-panel2\/30 flex flex-col shrink-0 max-h-\[35vh\] md:max-h-none">'\s*\+\s*'<div class="p-3 border-b border-line">'\s*\+\s*'<h2 class="font-display font-semibold text-sm">Venues & Spaces<\/h2>'\s*\+\s*'<\/div>'\s*\+\s*'<div class="flex-1 overflow-y-auto p-2 space-y-1">'\s*\+\s*spaces\.map\(sp => \{\s*const isActive = sp === m\.activeSpace;\s*return '<button data-space="' \+ ui\.esc\(sp\) \+ '" class="w-full text-left px-3 py-2 text-sm font-medium rounded-lg ' \+ \(isActive \? 'bg-panel border border-line shadow-xs text-ink' : 'text-muted hover:bg-panel\/50 hover:text-ink transition-colors'\) \+ '">'\s*\+\s*ui\.esc\(sp\)\s*\+\s*'<\/button>';\s*\}\)\.join\(''\)\s*\+\s*'<\/div>'\s*\+\s*'<div class="p-3 border-t border-line"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1\.5">' \+ ui\.icon\('plus', 'w-3 h-3'\) \+ ' Add Space<\/button><\/div>'\s*\+\s*'<\/div>'/g,
  `'<div class="w-full md:w-64 border-b md:border-b-0 md:border-r border-line bg-panel2/30 flex flex-col shrink-0 min-h-0">' +
          '<div class="hidden md:block p-3 border-b border-line">' +
            '<h2 class="font-display font-semibold text-sm">Venues & Spaces</h2>' +
          '</div>' +
          '<div class="flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto p-2 gap-2 md:gap-0 md:space-y-1 scrollbar-hide">' +
            spaces.map(sp => {
              const isActive = sp === m.activeSpace;
              return '<button data-space="' + ui.esc(sp) + '" class="whitespace-nowrap md:w-full text-left px-3 py-1.5 md:py-2 text-xs md:text-sm font-medium rounded-lg shrink-0 ' + (isActive ? 'bg-panel border border-line shadow-xs text-ink' : 'text-muted hover:bg-panel/50 hover:text-ink transition-colors') + '">' +
                ui.esc(sp) +
              '</button>';
            }).join('') +
            '<button id="btn-add-space-mobile" class="md:hidden whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-lg shrink-0 btn-ghost border border-dashed border-line flex items-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button>' +
          '</div>' +
          '<div class="hidden md:block p-3 border-t border-line mt-auto"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button></div>' +
        '</div>'`
);

// Update event listener to attach to both buttons
code = code.replace(
  /const btnAddSpace = m\.root\.querySelector\('#btn-add-space'\);\s*if \(btnAddSpace\) \{\s*btnAddSpace\.addEventListener\('click', \(\) => \{/g,
  `const btnAddSpaceEls = m.root.querySelectorAll('#btn-add-space, #btn-add-space-mobile');
    btnAddSpaceEls.forEach(btn => {
      btn.addEventListener('click', () => {`
);

// Don't forget to close the forEach block
code = code.replace(
  /RMTP\.LOCATIONS = RMTP\.SPACES\.concat\(RMTP\.STORES \|\| \[\]\);\s*m\.activeSpace = newName;\s*render\(\);\s*\}\s*\}\s*\}\);\s*\}/g,
  `RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES || []);
          m.activeSpace = newName;
          render();
        }
      }
    });
    });`
);

fs.writeFileSync('js/views/venues.js', code);
console.log('Patched sidebar!');
