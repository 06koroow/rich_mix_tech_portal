const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

code = code.replace(
  "if (typeof renderMatrix === 'function') renderMatrix();",
  "if (typeof renderSignalFlow === 'function') renderSignalFlow();\n          if (typeof renderRepatches === 'function') renderRepatches();\n          if (typeof renderMasterSchedule === 'function') renderMasterSchedule();"
);

fs.writeFileSync('js/views/presets.js', code);
