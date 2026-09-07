const fs = require('fs');
let content = fs.readFileSync('js/sync-supabase.js', 'utf8');

const replacement = `      rows = await sb.selectAll(table);
      clearTableUnsupported(table);
    } catch (err) {
      if (isTableMissingError(err)) {
        markTableUnsupported(table);
        console.warn('[syncSb] Table "' + table + '" is not present in remote Supabase schema cache (' + (err.message || err.code || 'PGRST205') + '). Running with local data for ' + coll + '. Run docs/supabase-setup.sql or docs/patch-sheets-setup.sql to enable cloud sync.');
        return;
      }
      
      // If we get a schema cache error during pull (like PGRST204 missing column from our wildcards),
      // we shouldn't throw the error, we should fallback to local data, otherwise the whole app wipes!
      // This handles cases where a column was added locally but Supabase is returning PGRST204 
      // because someone modified the table and didn't reload the cache, or vice-versa.
      if (err.code === 'PGRST204' || /schema cache/i.test(err.message || '')) {
         console.warn('[syncSb] Remote schema cache is stale for table "' + table + '" (' + (err.code || 'PGRST204') + '). Using local data cache for this run.');
         return; 
      }
      
      console.error('[syncSb] Error pulling collection: ' + coll, err);
      return; // Do NOT throw, failing to pull shouldn't break the app and clear local state!
    }`;

const regex = /rows = await sb\.selectAll\(table\);\n\s*clearTableUnsupported\(table\);\n\s*\} catch \(err\) \{[\s\S]*?throw err;\n\s*\}/;
content = content.replace(regex, replacement);

fs.writeFileSync('js/sync-supabase.js', content);
