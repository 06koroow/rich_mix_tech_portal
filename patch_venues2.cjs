const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

code = code.replace(
  /'<div class="flex items-center justify-between gap-2">'\s*\+\s*'<input type="text" id="v-inv-search" class="field w-64"/,
  "'<div class=\"flex flex-col md:flex-row md:items-center justify-between gap-3\">' +\n                '<input type=\"text\" id=\"v-inv-search\" class=\"field w-full md:w-64\""
);

// also verify flex gap-2 inside that is wrapped
code = code.replace(
  /class="field w-full md:w-64" placeholder="Search inventory..." value="' \+ ui\.esc\(m\.invSearch\) \+ '">'\s*\+\s*'<div class="flex gap-2">'/g,
  "class=\"field w-full md:w-64\" placeholder=\"Search inventory...\" value=\"' + ui.esc(m.invSearch) + '\">' +\n                '<div class=\"flex flex-wrap gap-2\">'"
);

fs.writeFileSync('js/views/venues.js', code);
console.log('Patched venues.js inventory controls');
