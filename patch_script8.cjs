const fs = require('fs');
let content = fs.readFileSync('js/sync-supabase.js', 'utf8');

const replacement = `    function isTableMissingError(err) {
    if (!err) return false;
    
    // Explicitly check for PGRST204 (Missing Column) and do NOT treat it as a missing table.
    // This is the bug: PGRST204 was triggering "schema cache" string match, causing the whole table to be marked unsupported.
    if (err.code === 'PGRST204') return false; 

    // Explicitly check for Missing Table
    if (err.code === 'PGRST205' || err.code === '42P01') return true;

    const msg = (err.message || '') + ' ' + (err.details || '') + ' ' + (err.hint || '') + ' ' + (typeof err === 'string' ? err : '');
    
    // We must be VERY careful with the string "schema cache". Both PGRST204 (missing column) 
    // and PGRST205 (missing table) mention "schema cache".
    // We only want to match if it explicitly says "find the X table" or "relation X does not exist".
    if (/relation .+ does not exist/i.test(msg)) return true;
    if (/Could not find the '.+' table/i.test(msg)) return true;
    
    // If it mentions schema cache but isn't explicitly a table error, assume it's NOT a table error 
    // (likely a column error) to avoid blacklisting the whole table.
    return false;
  }`;

const regex = /function isTableMissingError\(err\) \{[\s\S]*?return \/Could not find the table\/i\.test\(msg\) \|\| \/relation \.\+ does not exist\/i\.test\(msg\);\n\s*\}/;
content = content.replace(regex, replacement);

fs.writeFileSync('js/sync-supabase.js', content);
