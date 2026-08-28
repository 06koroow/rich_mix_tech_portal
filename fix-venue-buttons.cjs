const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

// replace the admin condition for Add Space
code = code.replace(
  /\(RMTP\.auth\.current\(\) && RMTP\.auth\.current\(\)\.admin \? '(<div class="p-3 border-t border-line"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1\.5">)' \+ ui\.icon\('plus', 'w-3 h-3'\) \+ ' Add Space<\/button><\/div>' : ''\) \+/g,
  `'<div class="p-3 border-t border-line"><button id="btn-add-space" class="btn btn-ghost w-full border border-dashed border-line text-xs flex items-center justify-center gap-1.5">' + ui.icon('plus', 'w-3 h-3') + ' Add Space</button></div>' +`
);

fs.writeFileSync('js/views/venues.js', code);
console.log("Patched venue add button");
