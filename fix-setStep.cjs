const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

code = code.replace(/for \(let i = 1; i <= 4; i\+\+\)/, 'for (let i = 1; i <= 5; i++)');
code = code.replace(/if \(typeof renderMasterSchedule === 'function'\) renderMasterSchedule\(\);/, "if (typeof renderMasterSchedule === 'function') renderMasterSchedule();\n          if (typeof renderMixingIOSummary === 'function') renderMixingIOSummary();");

fs.writeFileSync('js/views/presets.js', code);
console.log("Fixed setStep loop and injected renderMixingIOSummary call in els loop");
