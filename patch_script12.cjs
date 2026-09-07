const fs = require('fs');
let content = fs.readFileSync('js/sync-supabase.js', 'utf8');

content = content.replace(
  "console.warn('[syncSb] PGRST204 schema cache error on table \"' + table + '\", but couldn't parse missing column name. Dropping row from queue to prevent stall.', err);",
  "console.warn('[syncSb] PGRST204 schema cache error on table \"' + table + '\", but could not parse missing column name. Dropping row from queue to prevent stall.', err);"
);

fs.writeFileSync('js/sync-supabase.js', content);
