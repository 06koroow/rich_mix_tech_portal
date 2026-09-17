const fs = require('fs');
let code = fs.readFileSync('js/sync-supabase.js', 'utf8');

const target = `    const m2 = msg.match(/Could not find the public.([^.]+) or/);
    if (m2 && m2[1]) return m2[1];
    return null;`;

const replace = `    const m2 = msg.match(/Could not find the public.([^.]+) or/);
    if (m2 && m2[1]) return m2[1];
    const m3 = msg.match(/Could not find the '([^']+)' column of/);
    if (m3 && m3[1]) return m3[1];
    return null;`;

code = code.replace(target, replace);
fs.writeFileSync('js/sync-supabase.js', code);
