const fs = require('fs');
let code = fs.readFileSync('js/views/procedures.js', 'utf8');

code = code.replace(/c\.items\.length/g, '(c.items ? c.items.length : 0)');
code = code.replace(/cat\.items\.length/g, '(cat.items ? cat.items.length : 0)');

fs.writeFileSync('js/views/procedures.js', code);
