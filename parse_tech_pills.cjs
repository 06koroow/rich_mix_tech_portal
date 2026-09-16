const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const tEventTech = `'<div class="flex items-center gap-1.5">' + 
                ui.icon('wrench', 'w-3.5 h-3.5 text-muted') + 
                '<span class="text-muted">Techs:</span>' + 
                '<strong class="text-ink font-medium">' + ui.esc(leadTechStr) + '</strong>' + 
              '</div>' +`;

const rEventTech = `'<div class="flex items-center gap-1.5">' + 
                ui.icon('wrench', 'w-3.5 h-3.5 text-muted') + 
                '<span class="text-muted">Techs:</span>' + 
                '<div class="flex items-center gap-1 flex-wrap">' + 
                  (techs.length 
                    ? techs.map(t => t === 'No Tech Needed' ? ui.pill(t, 'var(--line)') : ui.pill(t, 'var(--info)')).join('')
                    : ui.pill('Unassigned', 'var(--danger)')) + 
                '</div>' +
              '</div>' +`;

code = code.replace(tEventTech, rEventTech);


const tGroupTech = `'<div class="flex items-center gap-1.5 text-muted">' + 
             ui.icon('wrench', 'w-3 h-3') + 
             '<span>Techs:</span>' + 
             '<strong class="text-ink font-medium">' + ui.esc(techStr) + '</strong>' +
           '</div>' +`;

const rGroupTech = `'<div class="flex items-center gap-1.5 text-muted">' + 
             ui.icon('wrench', 'w-3 h-3') + 
             '<span>Techs:</span>' + 
             '<div class="flex items-center gap-1 flex-wrap">' + 
                (techs.length 
                  ? techs.map(t => t === 'No Tech Needed' ? ui.pill(t, 'var(--line)') : ui.pill(t, 'var(--info)')).join('')
                  : ui.pill('Unassigned', 'var(--danger)')) + 
             '</div>' +
           '</div>' +`;

code = code.replace(tGroupTech, rGroupTech);

fs.writeFileSync('js/views/advancing.js', code);
