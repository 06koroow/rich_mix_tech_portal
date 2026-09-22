const fs = require('fs');
let code = fs.readFileSync('js/views/procedures.js', 'utf8');

const target1 = `(idx === (cat.items ? cat.items.length : 0) - 1 ? 'disabled' : '')`;
const replace1 = `(idx === ((cat.items ? cat.items.length : 0) - 1) ? 'disabled' : '')`;

code = code.replace(target1, replace1);

const target2 = `const list = (cat.items ? cat.items.length : 0)
      ? cat.items.map((i, idx) => {`;
const replace2 = `const list = (cat.items && cat.items.length > 0)
      ? cat.items.map((i, idx) => {`;

code = code.replace(target2, replace2);

const target3 = `        if (idx < (cat.items ? cat.items.length : 0) - 1) {
          const temp = cat.items[idx];`;
const replace3 = `        if (idx < (cat.items ? cat.items.length : 0) - 1 && cat.items) {
          const temp = cat.items[idx];`;

code = code.replace(target3, replace3);

const target4 = `      cat.items = cat.items.filter((x) => x.id !== item.id);   // move across tabs`;
const replace4 = `      cat.items = (cat.items || []).filter((x) => x.id !== item.id);   // move across tabs`;

code = code.replace(target4, replace4);

const target5 = `      cat.items = cat.items.filter((x) => x.id !== item.id);
      if (RMTP.supabase && RMTP.supabase.isConfigured() && RMTP.syncSb.deleteProcedureRow) RMTP.syncSb.deleteProcedureRow(item.id);`;
const replace5 = `      cat.items = (cat.items || []).filter((x) => x.id !== item.id);
      if (RMTP.supabase && RMTP.supabase.isConfigured() && RMTP.syncSb.deleteProcedureRow) RMTP.syncSb.deleteProcedureRow(item.id);`;

code = code.replace(target5, replace5);

const target6 = `      cat.items.push({ id, title, updated: '', body: '' });`;
const replace6 = `      if (!cat.items) cat.items = [];
      cat.items.push({ id, title, updated: '', body: '' });`;

code = code.replace(target6, replace6);

const target7 = `    let itemsCopy = cat.items.slice();`;
const replace7 = `    let itemsCopy = (cat.items || []).slice();`;

code = code.replace(target7, replace7);

const target8 = `  const item = itemId ? cat.items.find((i) => i.id === itemId) : null;`;
const replace8 = `  const item = itemId && cat.items ? cat.items.find((i) => i.id === itemId) : null;`;
code = code.replace(target8, replace8);

fs.writeFileSync('js/views/procedures.js', code);
