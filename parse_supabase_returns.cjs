const fs = require('fs');
let code = fs.readFileSync('js/supabase.js', 'utf8');

const targetUpsert = `  async function upsertRow(table, row) {
    const { error } = await db().from(table).upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }`;

const replaceUpsert = `  async function upsertRow(table, row) {
    const { error } = await db().from(table).upsert(row, { onConflict: 'id' });
    if (error) return { ok: false, error, message: error.message };
    return { ok: true };
  }`;

code = code.replace(targetUpsert, replaceUpsert);

const targetDelete = `  async function deleteRow(table, id) {
    const { error } = await db().from(table).delete().eq('id', id);
    if (error) throw error;
  }`;

const replaceDelete = `  async function deleteRow(table, id) {
    const { error } = await db().from(table).delete().eq('id', id);
    if (error) return { ok: false, error, message: error.message };
    return { ok: true };
  }`;

code = code.replace(targetDelete, replaceDelete);

fs.writeFileSync('js/supabase.js', code);
