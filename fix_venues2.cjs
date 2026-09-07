const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

// Undo the global damage
code = code.replace(/\n        \}\n      \}\);\n    \}\);\n/g, "\n        }\n      });\n    }\n");

fs.writeFileSync('js/views/venues.js', code);
console.log('Undone damage');
