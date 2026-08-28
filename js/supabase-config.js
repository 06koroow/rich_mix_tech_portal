/* ============================================================
   supabase-config.js — Supabase backend connection
   ------------------------------------------------------------
   Fill these in AFTER you've (1) created a Supabase project and
   (2) run docs/supabase-setup.sql in its SQL editor.
   See docs/SUPABASE-SETUP.md for exactly where each value lives.

   Leave `url` BLANK to keep the app in local (localStorage) mode
   — nothing here runs until it's set. The moment `url` + `anonKey`
   are filled and the Supabase SDK has loaded, the app switches to
   the Supabase backend on next load.

   Both values are safe to ship in client code: the anon key is a
   public key, and all access is gated by Row-Level Security in the
   database (see the SQL file). This is by design.
   ============================================================ */
RMTP.supabaseConfig = {
  url: 'https://xumaqyrilbmskcvpmjmk.supabase.co',        // Project settings → API → Project URL   (https://xxxx.supabase.co)
  anonKey: 'sb_publishable_eIbRs4RTeQn1aeYKPv7lrA_ejaLzuwT',    // Project settings → API → Project API keys → anon / public
  bucket: 'techfiles',   // Storage bucket for fault photos + tech specs (create it in the dashboard)

  // App collection  →  database table name. These already match the
  // table names created by docs/supabase-setup.sql, so you shouldn't
  // need to change them.
  tables: {
    inventory:         'inventory',
    maintenance:       'maintenance',
    advancing:         'advancing',
    reports:           'reports',
    users:             'users',
    signoffs:          'signoffs',
    procedures:        'procedures',
    patch_presets:     'patch_presets',
    patch_sheets:      'patch_sheets',
    dmx_personalities: 'dmx_personalities',
    dmx_patches:       'dmx_patches',
    venues:            'venues',
  },
};
