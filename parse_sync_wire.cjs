const fs = require('fs');
let code = fs.readFileSync('js/sync-supabase.js', 'utf8');

const targetWireUpsert = `           sb.upsertRow(table, record).then(result => {
              if (!result.ok) {
                 if (result.error && result.error.code === '42P01') {
                    markTableUnsupported(table);
                 } else if (result.error && result.error.code === 'PGRST204') {
                    const missingCol = extractMissingColumn(result.error);
                    if (missingCol) markColumnUnsupported(table, missingCol);
                 }
                 console.error('[syncSb] Optimistic sync failed for ' + name, result.message || result.error);
                 // We don't rollback the UI to avoid jarring behavior on transient errors,
                 // but we could notify the user here.
              }
           }).catch(e => console.error(e));`;

const replaceWireUpsert = `           const payload = { ...record };
           if (unsupportedCols[table]) {
             Object.keys(unsupportedCols[table]).forEach(col => delete payload[col]);
           }
           
           sb.upsertRow(table, payload).then(result => {
              if (result && !result.ok) {
                 if (result.error && result.error.code === '42P01') {
                    markTableUnsupported(table);
                 } else if (result.error && result.error.code === 'PGRST204') {
                    const missingCol = extractMissingColumn(result.error);
                    if (missingCol) {
                       markColumnUnsupported(table, missingCol);
                       const retryPayload = { ...payload };
                       delete retryPayload[missingCol];
                       sb.upsertRow(table, retryPayload);
                    }
                 }
                 console.error('[syncSb] Optimistic sync failed for ' + name, result.message || result.error);
              }
           }).catch(e => console.error(e));`;

code = code.replace(targetWireUpsert, replaceWireUpsert);
fs.writeFileSync('js/sync-supabase.js', code);
