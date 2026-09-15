const fs = require('fs');
let code = fs.readFileSync('supabase/functions/artifax-sync/index.ts', 'utf8');

code = code.replace(
  /title: r\.title \?\? r\.name \?\? r\.EventName \?\? "Untitled",/,
  'title: String(r.title || r.name || r.EventName || "Untitled"),'
);

fs.writeFileSync('supabase/functions/artifax-sync/index.ts', code);
