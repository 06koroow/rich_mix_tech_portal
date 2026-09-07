const fs = require('fs');
let content = fs.readFileSync('js/views/presets.js', 'utf8');

const regex = /let actsWithChannels = \(sheet\.acts \|\| \[\]\)\.filter\(a => a\.channelInputs && a\.channelInputs\.length > 0 && a\.id !== 'act-house'\);/;
const replacement = `let actsWithChannels = (sheet.acts || []).filter(a => a.channelInputs && a.channelInputs.length > 0);`;
content = content.replace(regex, replacement);

fs.writeFileSync('js/views/presets.js', content);
