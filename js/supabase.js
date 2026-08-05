/* ============================================================
   supabase.js — Supabase client: auth + data + storage
   ------------------------------------------------------------
   Thin wrapper over @supabase/supabase-js (loaded from a CDN in
   index.html as the global `supabase`). Nothing here touches the
   network at load time; it only acts when the app boots in backend
   mode (supabase-config.js filled in).

   This is a working-shaped skeleton — it needs your project URL +
   anon key and testing against your database. See
   docs/SUPABASE-SETUP.md.
   ============================================================ */
RMTP.supabase = (function () {
  let client = null;
  const cfg = () => RMTP.supabaseConfig || {};

  // Backend mode is on only when url + anonKey are set AND the SDK loaded.
  function isConfigured() {
    return !!cfg().url && !!cfg().anonKey && typeof window.supabase !== 'undefined' && !!window.supabase.createClient;
  }

  function init() {
    if (client) return client;
    client = window.supabase.createClient(cfg().url, cfg().anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rmtp-sb-auth' },
    });
    return client;
  }
  function db() { return client || init(); }

  /* ---- Auth ---- */
  async function restoreSession() {
    const { data } = await db().auth.getSession();
    const email = data && data.session && data.session.user && data.session.user.email;
    return email || null;
  }
  async function signIn(email, password) {
    const { data, error } = await db().auth.signInWithPassword({ email: email, password: password });
    if (error) return { ok: false, message: error.message, error: error };
    return { ok: true, email: data.user && data.user.email };
  }
  async function signUp(email, password) {
    const { data, error } = await db().auth.signUp({ email: email, password: password });
    if (error) return { ok: false, message: error.message, error: error };
    return { ok: true, email: data.user && data.user.email };
  }
  async function signOut() { try { await db().auth.signOut(); } catch (e) { /* ignore */ } }
  async function currentEmail() {
    const { data } = await db().auth.getUser();
    return (data && data.user && data.user.email) || null;
  }

  /* ---- Data (tables mirror the app's collection names) ---- */
  async function selectAll(table) {
    const { data, error } = await db().from(table).select('*');
    if (error) throw error;
    return data || [];
  }
  async function upsertRow(table, row) {
    const { error } = await db().from(table).upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }
  async function deleteRow(table, id) {
    const { error } = await db().from(table).delete().eq('id', id);
    if (error) throw error;
  }

  /* ---- Storage (fault photos + tech specs) ---- */
  // Uploads a Blob and returns a public URL (bucket must be public, or
  // swap getPublicUrl for createSignedUrl if you keep it private).
  async function uploadFile(path, blob, contentType) {
    const bucket = cfg().bucket || 'techfiles';
    const { error } = await db().storage.from(bucket).upload(path, blob, { upsert: true, contentType: contentType || 'application/octet-stream' });
    if (error) throw error;
    const { data } = db().storage.from(bucket).getPublicUrl(path);
    return data && data.publicUrl;
  }

  /* ---- Edge Functions ---- */
  async function invokeFunction(name, body) {
    const { data, error } = await db().functions.invoke(name, { body: body || {} });
    if (error) return { ok: false, message: error.message, error: error };
    return { ok: true, data: data };
  }

  return { isConfigured, init, restoreSession, signIn, signUp, signOut, currentEmail, selectAll, upsertRow, deleteRow, uploadFile, invokeFunction };
})();
