# Pulling events from Artifax into the Tech Portal

This wires Artifax (your booking source of truth) to the Portal's **Advancing**
list. It runs as a **Supabase Edge Function** so the Artifax API key stays
server-side and never touches the browser. It's one-way: Artifax owns the booking
facts (what/where/when/who booked); the Portal's own fields (assigned tech, tech
info, tech spec) are preserved on every sync.

```
Artifax  →  artifax-sync (Edge Function, secret key)  →  Supabase `advancing`  →  the Portal reads it
```

## 0. What you need
- The **Supabase CLI** installed (`npm i -g supabase`), and your project ref.
- An **Artifax API key** and your Artifax URL. In Artifax: **Admin → Configuration
  → API**. The user group tied to the key needs access to Configuration,
  Arrangements and Events. If unsure, ask Artifax Support — and tell them you're
  building an internal connector (their API terms allow this; a *commercial*
  connector would need their approval).
- The Artifax **API docs** (endpoints + response fields) from the same page or
  from Artifax Support — you'll paste the exact endpoint into the function.

## 1. Add the `artifaxId` column (existing databases)
Fresh setups get it from `supabase-setup.sql`. If your `advancing` table already
exists, run this once in the SQL Editor:
```sql
alter table public.advancing add column if not exists "artifaxId" text;
create unique index if not exists advancing_artifax_uniq
  on public.advancing ("artifaxId") where "artifaxId" is not null;
```

## 2. Point the function at Artifax
Open `supabase/functions/artifax-sync/index.ts` and edit two things:
- **`ROOM_TO_SPACE`** — map your exact Artifax room names to the six spaces.
- **`fetchArtifaxInstances()`** — set the real endpoint, query params and response
  field names from the Artifax docs. The `TODO` comments show exactly where. The
  rest of the function (mapping, upsert, preserving tech fields) needs no changes.

## 3. Set the secrets
```bash
supabase login
supabase link --project-ref xumaqyrilbmskcvpmjmk
supabase secrets set ARTIFAX_URL="https://yourorg.artifaxevent.com"
supabase secrets set ARTIFAX_API_KEY="<your Artifax API key>"
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to the
function — don't set those.)

## 4. Deploy
```bash
supabase functions deploy artifax-sync
```

## 5. Test it
- In the app, sign in as an admin → **Advancing → Refresh from Artifax**. You'll get
  a toast like "Artifax: 12 added, 3 updated", and the events appear in the list.
- Or from the CLI: `supabase functions invoke artifax-sync` and read the JSON
  (`created` / `updated` / `skipped`). `skipped` counts events in rooms that aren't
  in your `ROOM_TO_SPACE` map — add them if they should come through.

## 6. Schedule it (optional but recommended)
So events refresh without anyone clicking. In the Supabase dashboard, enable the
**pg_cron** and **pg_net** extensions, then schedule an invoke — e.g. every 20 min:
```sql
select cron.schedule('artifax-sync', '*/20 * * * *', $$
  select net.http_post(
    url := 'https://xumaqyrilbmskcvpmjmk.functions.supabase.co/artifax-sync',
    headers := jsonb_build_object('Authorization', 'Bearer <SUPABASE_ANON_OR_SERVICE_KEY>')
  );
$$);
```

---

### How it behaves (worth knowing)
- **Tech fields are safe.** On each sync the function updates only booking fields
  (name, space, date, times, contact, status) on existing rows and leaves
  `techUserId`, `techInfo`, `techSpec` and any linked reports untouched. Re-syncing
  never wipes what your team added.
- **No duplicates.** Rows are matched on `artifaxId`, so re-running updates in place.
- **Cancellations** in Artifax set the event's status to `Cancelled` (they're not
  deleted, so you keep the history and any tech notes).
- **Recurring events** come through as separate dated instances — that's expected.
- **Rate limits.** Keep the schedule sensible (15–30 min) and use the manual button
  sparingly; Artifax expects reasonable request volumes.
- **Data residency.** You're copying some contact data into Supabase — keep the
  Supabase project in the EU to match Artifax's UK/EU hosting.
