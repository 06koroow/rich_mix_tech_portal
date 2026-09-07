const fs = require('fs');
let content = fs.readFileSync('js/app.js', 'utf8');

const replacement = `      if (RMTP.supabase && RMTP.supabase.isConfigured()) {
        try {
          await RMTP.syncSb.pullAll();                          // hydrate cache from Supabase
        } catch (err) {
          console.error('[app] Initial Supabase pullAll failed, but continuing with local cache.', err);
        }
        RMTP.syncSb.wire();                                   // start saving all future local changes to queue
        RMTP.syncSb.drain();                                  // flush any offline changes up to Supabase
      }`;

const regex = /if \(RMTP\.supabase && RMTP\.supabase\.isConfigured\(\)\) \{[\s\S]*?RMTP\.syncSb\.drain\(\);[\s\S]*?\}/;
content = content.replace(regex, replacement);

fs.writeFileSync('js/app.js', content);
