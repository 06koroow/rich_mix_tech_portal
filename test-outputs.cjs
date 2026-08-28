const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const regex1 = /capacity: count,\n          channels: Array\.from/g;
if (code.match(regex1)) {
    console.log("Matched regex1");
}
