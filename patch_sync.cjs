const fs = require('fs');
let code = fs.readFileSync('js/sync-supabase.js', 'utf8');

const regex = /schedule_items:\s*Array\.isArray\(r\.schedule_items\)\s*\?\s*r\.schedule_items\s*:\s*\(Array\.isArray\(r\.scheduleItems\)\s*\?\s*r\.scheduleItems\s*:\s*\[\]\),/g;

code = code.replace(regex, `schedule_items: await Promise.all((Array.isArray(r.schedule_items) ? r.schedule_items : (Array.isArray(r.scheduleItems) ? r.scheduleItems : [])).map(async (it) => {
          if (it.techFile) {
            it.techFile = await files.toRemote(it.techFile);
          }
          return it;
        })),`);

fs.writeFileSync('js/sync-supabase.js', code);
console.log('Patched sync-supabase.js');
