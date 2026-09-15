const fs = require('fs');
let code = fs.readFileSync('js/sync-supabase.js', 'utf8');
code = code.replace('return { pull, wire, verifySync };', 'return { pull, pullAll: pull, wire, verifySync };');
fs.writeFileSync('js/sync-supabase.js', code);
