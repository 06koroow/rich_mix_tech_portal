const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');
code = code.replace(
  /duration: it\.duration \|\| ''/,
  "duration: it.duration || '',\n        channelInputs: Array.isArray(it.channelInputs) ? JSON.parse(JSON.stringify(it.channelInputs)) : [],\n        channelOutputs: Array.isArray(it.channelOutputs) ? JSON.parse(JSON.stringify(it.channelOutputs)) : []"
);
fs.writeFileSync('js/views/presets.js', code);
