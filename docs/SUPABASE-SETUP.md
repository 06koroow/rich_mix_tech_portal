# Rich Mix — Tech Portal on Supabase

This wires the app to a Supabase backend (Postgres + Auth + Storage) instead of
SharePoint. It's self-serve — no Microsoft admin, no consent, no waiting. When
you're done, `js/supabase-config.js` holds two values and the app switches from
local mode to the shared backend on next load. The SharePoint files stay in place
but dormant, so that option is still there.

> Data note: this moves your data (including staff names + emails) out of your
> Microsoft tenant to Supabase. Pick an **EU region** at project creation for UK
> GDPR, and make that call consciously with whoever owns data governance.

## 1. Create the project
1. Go to supabase.com, sign up (email or GitHub — no card), **New project**.
2. Name it, set a database password (save it), choose an **EU** region. Wait ~2 min.

## 2. Build the database
Open **SQL Editor → New query**, paste the whole of `docs/supabase-setup.sql`, and
**Run**. That creates the seven tables, the role helpers, Row-Level Security, and
the starter data. It's safe to re-run.

## 3. Create the file bucket
**Storage → New bucket**, name it `techfiles`, set it **Public** (simplest — the
app stores public URLs). If you'd rather keep it private, swap `getPublicUrl` for
`createSignedUrl` in `js/supabase.js`.

## 4. Auth settings
**Authentication → Providers → Email**: make sure it's enabled. For an internal
tool, turn **Confirm email OFF** (Authentication → Providers → Email → "Confirm
email") so sign-up and sign-in work immediately without a confirmation round-trip.
(Leave it on only if you want people to verify their address first.)

## 5. Give yourself a login
The `users` table is seeded with staff *profiles*, but a profile isn't a login —
credentials live in Supabase Auth. Quickest path to an admin account:

- **Authentication → Users → Add user**, email `alex@richmix.local`, set a password,
  create. That email matches the seeded admin profile, so you can now sign in as a
  full admin.

Alternatively, sign up in-app with your real email, then in the SQL editor run:
`update public.users set "admin"=true, "trainer"=true, "status"='active' where "email"='you@yourdomain';`
(or insert a profile row for yourself).

Everyone else can then use **Request access** in the app — they land as `pending`
and you approve them from the dashboard in-tray or the Users page.

## 6. Get your keys
**Project Settings → API**: copy the **Project URL** and the **anon / public** key.

## 7. Point the app at it
Open `js/supabase-config.js` and fill in:
```js
url:     'https://xxxx.supabase.co',
anonKey: 'eyJhbGciOi...',      // the anon/public key — safe to ship
bucket:  'techfiles',
```
Both are safe in client code; all real protection is the RLS you just enabled.

## 8. Host it and set the site URL
Host the static files anywhere with HTTPS (GitHub Pages or Cloudflare Pages — free,
no card, no admin). Then in Supabase, **Authentication → URL Configuration**, set
**Site URL** to your hosted URL. Open the app — it detects Supabase, pulls the
data, and shows the sign-in screen.

## 9. Prove the round-trip
Sign in with the account from step 5, watch a list load, create one inventory item,
and check it appears in **Table Editor → inventory**. That confirms auth, read, and
write end-to-end.

---

### Notes & gotchas
- **Files** upload to the `techfiles` bucket on save and the record stores the URL.
- **Free projects pause after ~7 days idle** — resume from the dashboard (~30s), or
  add a scheduled ping to keep it warm. Data survives the pause.
- **RLS starts permissive** (any signed-in user can read/write). Tighten it with the
  commented examples at the bottom of the SQL — e.g. only trainers insert sign-offs,
  only admins update users.
- **Switching back to local mode**: blank out `url` in `supabase-config.js`.
- **SharePoint stays available**: if you ever fill in `graph-config.js` instead,
  the app uses SharePoint. Supabase takes priority when both are configured.
