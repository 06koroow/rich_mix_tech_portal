const fs = require('fs');
let code = fs.readFileSync('js/sync-supabase.js', 'utf8');

// Replace export
code = code.replace(
  'return { pull, pullAll: pull, wire, verifySync };',
  'return { pull, pullAll: pull, pullCollection, wire, verifySync, drain: async () => {}, deleteProcedureRow: (id) => RMTP.supabase.deleteRow("procedures", id) };'
);

fs.writeFileSync('js/sync-supabase.js', code);
