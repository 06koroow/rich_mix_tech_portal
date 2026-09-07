const fs = require('fs');
let code = fs.readFileSync('js/views/maintenance.js', 'utf8');

code = code.replace(
  /'<div class="grid grid-cols-2 gap-3">'/g,
  "'<div class=\"grid grid-cols-1 sm:grid-cols-2 gap-3\">'"
);

fs.writeFileSync('js/views/maintenance.js', code);
console.log('Patched maintenance.js');
