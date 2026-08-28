const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const regex = /if \(nextBtn\) \{\n\s*nextBtn\.style\.display = \(currentStep === 4 \? 'none' : 'inline-flex'\);\n\s*const nextLabels = \['', 'Stageboxes & Drops &rarr;', '⚡ Signal Flow &rarr;', 'Repatches & Summary &rarr;', ''\];\n\s*nextBtn\.innerHTML = 'Next: ' \+ \(nextLabels\[currentStep\] \|\| 'Next &rarr;'\);\n\s*\}/;

const replacement = `if (nextBtn) {
        nextBtn.style.display = (currentStep === 5 ? 'none' : 'inline-flex');
        const nextLabels = ['', 'Stageboxes & Drops &rarr;', '⚡ Signal Flow &rarr;', 'Repatches & Summary &rarr;', 'IO Summary &rarr;', ''];
        nextBtn.innerHTML = 'Next: ' + (nextLabels[currentStep] || 'Next &rarr;');
      }`;

if (code.match(regex)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('js/views/presets.js', code);
    console.log("Fixed next bounds");
} else {
    console.log("Could not find next bounds to fix");
}

const prevLabelsRegex = /const prevLabels = \['', '', 'Event & Acts', 'Stageboxes & Drops', '⚡ Signal Flow'\];/;
code = code.replace(prevLabelsRegex, "const prevLabels = ['', '', 'Event & Acts', 'Stageboxes & Drops', '⚡ Signal Flow', 'Repatches & Summary'];");

fs.writeFileSync('js/views/presets.js', code);
console.log("Fixed prev bounds");
