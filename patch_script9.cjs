const fs = require('fs');
let content = fs.readFileSync('js/sync-supabase.js', 'utf8');

const replacement = `      const rowToSend = sanitizeRow(table, baseRow);
      try {
        await sb.upsertRow(table, rowToSend);
        // If we succeeded, we know the table is completely fine.
        clearTableUnsupported(table);
        return;
      } catch (err) {
        if (isTableMissingError(err)) {
          markTableUnsupported(table);
          console.warn('[syncSb] Table "' + table + '" does not exist in remote Supabase schema cache. Skipping upsert.');
          return;
        }
        
        // If it's a missing column (PGRST204), but we can't extract the name, we shouldn't throw an error and kill the sync queue forever.
        // The table exists, but the schema cache is out of date. 
        if (err.code === 'PGRST204') {
            const missingCol = extractMissingColumn(err);
            if (missingCol && (baseRow[missingCol] !== undefined || rowToSend[missingCol] !== undefined)) {
              markColumnUnsupported(table, missingCol);
              console.warn('[syncSb] Table "' + table + '" missing column "' + missingCol + '" in remote schema cache (PGRST204). Pruning for Supabase upsert.');
              delete baseRow[missingCol];
              continue; // Retry loop
            } else {
              // We couldn't parse the exact column, but we know it's a PGRST204 schema cache issue.
              // Just warn and drop this row from the sync queue to prevent the queue from stalling completely.
              // (Or we could attempt a reload of the schema cache here, but dropping is safer for now).
              console.warn('[syncSb] PGRST204 schema cache error on table "' + table + '", but couldn\'t parse missing column name. Dropping row from queue to prevent stall.', err);
              return; 
            }
        }
        
        throw err;
      }`;

const regex = /const rowToSend = sanitizeRow\(table, baseRow\);\n\s*try \{[\s\S]*?throw err;\n\s*\}/;
content = content.replace(regex, replacement);

fs.writeFileSync('js/sync-supabase.js', content);
