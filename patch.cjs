const fs = require('fs');
let code = fs.readFileSync('supabase/functions/artifax-sync/index.ts', 'utf8');

code = code.replace(
  /groupId: String\(r\.arrangement_id \?\? r\.arrangementId \?\? r\.ArrangementId \?\? r\.groupId \?\? r\.GroupId \?\? ""\),/,
  'groupId: String(r.arrangement_id ?? r.arrangementId ?? r.ArrangementId ?? r.groupId ?? r.GroupId ?? r.event_id ?? r.EventId ?? r.title ?? r.name ?? ""),'
);

fs.writeFileSync('supabase/functions/artifax-sync/index.ts', code);
