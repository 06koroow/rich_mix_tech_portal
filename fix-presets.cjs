const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const regex = /inputChannels: parseInt\(v\.audio\.inputChannels, 10\) \|\| 32,\n\s*outputChannels: parseInt\(v\.audio\.outputChannels, 10\) \|\| 16,/;
const replacement = \`inputChannels: parseInt(v.audio.inputChannels, 10) || 32,
          localInputChannels: parseInt(v.audio.localInputChannels, 10) || 0,
          outputChannels: parseInt(v.audio.outputChannels, 10) || 16,
          localOutputChannels: parseInt(v.audio.localOutputChannels, 10) || 0,\`;

if (code.match(regex)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync('js/views/presets.js', code);
    console.log("Updated presets.js to inherit local I/O");
} else {
    console.log("Regex not found in presets.js");
}
