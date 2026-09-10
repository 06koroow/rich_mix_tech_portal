const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const anchor = "blankOpt(RMTP.SPACES, ev.space, '\\u25cb Choose a Space / Room\\u2026') +";

if (code.includes(anchor) && !code.includes('value="Multi Room"')) {
  code = code.replace(
    anchor, 
    anchor + "\n                    (!existing ? '<option value=\"Multi Room\">Multi Room...</option>' : '') +"
  );
  
  const divAnchor = "</select>' +\n                '</div>' +";
  const newHtml = `</select>' +
                '</div>' +
                '<div id="e-multi-room-wrap" class="hidden mt-3 p-3 bg-panel2/50 border border-line rounded-lg">' +
                  '<p class="text-[11px] font-bold text-ink uppercase tracking-wider mb-2">Select Linked Spaces</p>' +
                  '<div class="grid grid-cols-2 gap-2">' +
                    RMTP.SPACES.map(s => '<label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" name="e-multi-spaces" value="'+s+'" class="w-3.5 h-3.5 accent-[var(--accent)]"><span>'+s+'</span></label>').join('') +
                  '</div>' +
                '</div>' +`;
  
  code = code.replace(divAnchor, newHtml);
  
  fs.writeFileSync('js/views/advancing.js', code);
  console.log("Fixed via regex!");
} else {
  console.log("Anchor not found or already applied.");
}
