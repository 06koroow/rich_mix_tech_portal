const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

code = code.replace(/ui\.pill\(t, 'var\(--line\)'\)/g, "ui.pill(t, 'var(--muted)')");
fs.writeFileSync('js/views/advancing.js', code);
