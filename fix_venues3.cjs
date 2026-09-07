const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

const lines = code.split('\n');
if (lines[333].trim() === '}') {
  lines[333] = '    });';
}

fs.writeFileSync('js/views/venues.js', lines.join('\n'));
console.log('Fixed btnAddSpaceEls forEach');
