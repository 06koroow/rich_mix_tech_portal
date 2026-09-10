const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const s1 = `                  '<select id="e-space" class="field font-semibold text-accent pl-8.5 cursor-pointer ' + (!hasSpaceInitial ? 'border-accent/40 bg-accent/5 ring-2 ring-accent/10' : '') + '">\\' +
                    blankOpt(RMTP.SPACES, ev.space, '\\u25cb Choose a Space / Room\\u2026') +
                  '</select>' +
                '</div>' +`;
const r1 = `                  '<select id="e-space" class="field font-semibold text-accent pl-8.5 cursor-pointer ' + (!hasSpaceInitial ? 'border-accent/40 bg-accent/5 ring-2 ring-accent/10' : '') + '">\\' +
                    blankOpt(RMTP.SPACES, ev.space, '\\u25cb Choose a Space / Room\\u2026') +
                    (!existing ? '<option value="Multi Room">Multi Room...</option>' : '') +
                  '</select>' +
                '</div>' +
                '<div id="e-multi-room-wrap" class="hidden mt-3 p-3 bg-panel2/50 border border-line rounded-lg">' +
                  '<p class="text-[11px] font-bold text-ink uppercase tracking-wider mb-2">Select Linked Spaces</p>' +
                  '<div class="grid grid-cols-2 gap-2">' +
                    RMTP.SPACES.map(s => '<label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" name="e-multi-spaces" value="'+s+'" class="w-3.5 h-3.5 accent-[var(--accent)]"><span>'+s+'</span></label>').join('') +
                  '</div>' +
                '</div>' +`;

code = code.replace(s1, r1);
fs.writeFileSync('js/views/advancing.js', code);
console.log("Fixed!");
