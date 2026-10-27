const fs = require('fs');
const lines = fs.readFileSync('js/views/dcp.js', 'utf8').split('\n');
console.log(lines.slice(244, 310).join('\n'));
