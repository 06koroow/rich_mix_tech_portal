const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

code = code.replace(
  /if \(currentStep === 4\) \{\n\s*renderRepatches\(\);\n\s*renderMasterSchedule\(\);\n\s*\}/,
  `if (currentStep === 4) {
        renderRepatches();
        renderMasterSchedule();
      }
      if (currentStep === 5) {
        if (typeof renderMixingIOSummary === 'function') renderMixingIOSummary();
      }`
);

fs.writeFileSync('js/views/presets.js', code);
console.log("Injected render call into setStep");
