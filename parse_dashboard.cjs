const fs = require('fs');
let code = fs.readFileSync('js/views/dashboard.js', 'utf8');

code = code.replace(/c\.items\.length/g, '(c.items ? c.items.length : 0)');

fs.writeFileSync('js/views/dashboard.js', code);
