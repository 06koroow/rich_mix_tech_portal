const fs = require('fs');
let content = fs.readFileSync('js/sync-supabase.js', 'utf8');

const replacement = `  function extractMissingColumn(err) {
    if (!err) return null;
    const msg = (err.message || '') + ' ' + (err.details || '') + ' ' + (err.hint || '') + ' ' + (typeof err === 'string' ? err : '');
    if (!msg.trim()) return null;
    let match = msg.match(/Could not find the '([^']+)' column/i);
    if (match) return match[1];
    match = msg.match(/column "?([a-zA-Z0-9_]+)"? of relation/i);
    if (match) return match[1];
    match = msg.match(/column "?([a-zA-Z0-9_]+)"? does not exist/i);
    if (match) return match[1];
    // Supabase JS often doesn't give the exact column name for PGRST204 in the message if we used a wildcard, 
    // but the error is explicitly that the schema cache is stale.
    // Let's at least ensure we don't crash if we can't parse the column.
    return null;
  }`;

const regex = /function extractMissingColumn\(err\) \{[\s\S]*?return null;\n\s*\}/;
content = content.replace(regex, replacement);

fs.writeFileSync('js/sync-supabase.js', content);
