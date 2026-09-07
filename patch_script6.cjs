const fs = require('fs');
let content = fs.readFileSync('js/sync-supabase.js', 'utf8');

const replacement = `  function isTableMissingError(err) {
    if (!err) return false;
    // Note: PGRST204 is missing column, PGRST205 is missing table. 
    // Wait, the user error said: proxy-status: PostgREST; error=PGRST204 
    // AND: [syncSb] Table "advancing" does not exist in remote Supabase schema cache. Skipping upsert.
    // That means PGRST204 was triggering isTableMissingError!
    if (err.code === 'PGRST205' || err.code === '42P01') return true;
    if (err.code === 'PGRST204') return false; // This is a missing column error, NOT a missing table!
    const msg = (err.message || '') + ' ' + (err.details || '') + ' ' + (err.hint || '') + ' ' + (typeof err === 'string' ? err : '');
    return /Could not find the table/i.test(msg) || /relation .+ does not exist/i.test(msg);
  }`;

const regex = /function isTableMissingError\(err\) \{[\s\S]*?schema cache\/i\.test\(msg\);\n\s*\}/;
content = content.replace(regex, replacement);

fs.writeFileSync('js/sync-supabase.js', content);
