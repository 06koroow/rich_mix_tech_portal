const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const regex = /'<div class="flex justify-end pt-1">' \+\n\s*'<button type="button" data-ch-duplicate="' \+ sbIdx \+ '-' \+ chIdx \+ '" class="btn btn-ghost !py-1 !px-2\.5 text-\[10px\] text-accent font-semibold flex items-center gap-1 border border-accent\/20">' \+\n\s*ui\.icon\('copy', 'w-3 h-3'\) \+ '<span>Add Changeover \/ Repatch<\/span>' \+\n\s*'<\/button>' \+\n\s*'<\/div>'/s;

const replacement = `'<div class="flex justify-end pt-1">' +
                        '<button type="button" data-ch-duplicate="' + sbIdx + '-' + chIdx + '" class="btn btn-ghost !py-1 !px-2.5 text-[10px] text-accent font-semibold flex items-center gap-1 border border-accent/20">' +
                          ui.icon('copy', 'w-3 h-3') + '<span>Add Changeover</span>' +
                        '</button>' +
                      '</div>'`;

if (code.match(regex)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Updated mobile repatch button");
} else {
  console.log("Failed to match regex for mobile repatch button");
}
