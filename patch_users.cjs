const fs = require('fs');
let code = fs.readFileSync('js/views/users.js', 'utf8');

code = code.replace(
  /'<div class="grid grid-cols-2 gap-4">'/g,
  "'<div class=\"grid grid-cols-1 sm:grid-cols-2 gap-4\">'"
);

fs.writeFileSync('js/views/users.js', code);
console.log('Patched users grid cols');
