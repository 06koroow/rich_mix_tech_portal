const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

const lines = code.split('\n');
// Line 334 should be `    });` which is correct for btnAddSpaceEls.
// Line 355 is currently `    });` but should be `    }` for btnDeleteSpace.

if (lines[354].trim() === '});') {
  lines[354] = '    }';
}

fs.writeFileSync('js/views/venues.js', lines.join('\n'));
console.log('Fixed line 355');
