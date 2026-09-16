const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
const version = Date.now();
html = html.replace(/src="(js\/[^"]+\.js)(?:\?v=\d+)?"/g, 'src="$1?v=' + version + '"');
fs.writeFileSync('index.html', html);
